"""Tests for running the trip plan evals through Prefactor judges.

Run from the repository root:
    mise run test packages/langchain/examples/trip_planner/test_evals.py
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from evals import Check, PrefactorJudges, quality_payload

INSTANCE_ID = "instance-1"
JUDGES = {"judge-rules": "Trip plan rules", "judge-grounded": "Trip plan grounded"}
# A run that is not complete leaves the previous draft's judgement in place.
STALE_JUDGEMENT = {"verdict": "pass", "explanation": "Previous draft."}

TIMEOUT: dict[str, Any] = {}


class FakePrefactor:
    """Answers the Prefactor API calls that ``PrefactorJudges`` makes."""

    def __init__(self, judge_runs: dict[str, list[dict[str, Any]]]) -> None:
        self.judge_runs = judge_runs
        self.asked: list[str] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api/v1")
        if path == f"/agent_instance/{INSTANCE_ID}":
            assert request.url.params["include_judges"] == "true"
            return ok({"details": self._instance(request)})
        if path == f"/agent_instance/{INSTANCE_ID}/judge":
            judge_id = json.loads(request.content)["judge_agent_id"]
            self.asked.append(judge_id)
            return ok({"summary": {"id": f"run-{judge_id}", "status": "preparing"}})
        raise AssertionError(f"Unexpected request: {request.method} {request.url}")

    def _instance(self, request: httpx.Request) -> dict[str, Any]:
        return {
            "id": INSTANCE_ID,
            "judges": [self._judge(judge_id, request) for judge_id in JUDGES],
        }

    def _judge(self, judge_id: str, request: httpx.Request) -> dict[str, Any]:
        judge: dict[str, Any] = {
            "id": judge_id,
            "name": JUDGES[judge_id],
            "latest_instance": None,
            "latest_judgement": None,
        }
        if judge_id not in self.asked:
            return judge
        runs = self.judge_runs[judge_id]
        run = runs.pop(0) if len(runs) > 1 else runs[0]
        if run is TIMEOUT:
            raise httpx.ReadTimeout("Prefactor was slow", request=request)
        status = run["status"]
        judge["latest_instance"] = {"id": f"run-{judge_id}", "status": status}
        if status == "complete":
            judge["latest_judgement"] = run.get("result_payload")
        else:
            judge["latest_judgement"] = STALE_JUDGEMENT
        return judge


def ok(body: dict[str, Any]) -> httpx.Response:
    return httpx.Response(200, json={"status": "success", **body})


def finished(verdict: str, explanation: str) -> dict[str, Any]:
    return {
        "status": "complete",
        "result_payload": {"verdict": verdict, "explanation": explanation},
    }


def judges_for(fake: FakePrefactor) -> PrefactorJudges:
    return PrefactorJudges(
        api_url="http://prefactor.test",
        api_token="token",
        poll_seconds=0,
        flush_seconds=0,
        transport=httpx.MockTransport(fake.handle),
    )


async def test_asks_every_judge_of_the_agent_and_returns_their_verdicts():
    fake = FakePrefactor(
        {
            "judge-rules": [
                {"status": "active"},
                finished("pass", "Every rule holds."),
            ],
            "judge-grounded": [finished("fail", "Gold history is not in the record.")],
        },
    )

    checks = await judges_for(fake)(INSTANCE_ID)

    assert sorted(fake.asked) == sorted(JUDGES)
    assert sorted(checks, key=lambda check: check.name) == [
        Check("Trip plan grounded", False, "Gold history is not in the record."),
        Check("Trip plan rules", True, "Every rule holds."),
    ]


async def test_a_judge_that_does_not_finish_fails_its_check():
    fake = FakePrefactor(
        {
            "judge-rules": [{"status": "failed", "result_payload": None}],
            "judge-grounded": [finished("pass", "Fine.")],
        },
    )

    checks = await judges_for(fake)(INSTANCE_ID)

    assert (
        Check("Trip plan rules", False, "The judge gave no verdict (status failed).")
        in checks
    )


async def test_a_slow_status_check_does_not_stop_the_wait_for_a_verdict():
    fake = FakePrefactor(
        {
            "judge-rules": [TIMEOUT, finished("pass", "Every rule holds.")],
            "judge-grounded": [finished("pass", "Fine.")],
        },
    )

    checks = await judges_for(fake)(INSTANCE_ID)

    assert Check("Trip plan rules", True, "Every rule holds.") in checks


@pytest.mark.parametrize(
    ("passed", "expected_score"),
    [((True, True, True, True), 100), ((True, False, True, False), 50)],
)
def test_quality_payload_scores_the_share_of_checks_passed(passed, expected_score):
    checks = [Check(f"check_{i}", ok, "detail") for i, ok in enumerate(passed)]

    payload = quality_payload(checks, attempt=2)

    assert payload == {
        "passed": all(passed),
        "score": expected_score,
        "attempt": 2,
        "checks": [
            {"name": check.name, "passed": check.passed, "detail": "detail"}
            for check in checks
        ],
    }
