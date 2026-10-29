"""Evals for trip plans, run by Prefactor judges.

``PrefactorJudges`` asks every judge of the trip planner instance to score
the run so far, through Prefactor's on-demand judge API, and reads their
verdicts from that instance. Each judge reads the whole run record, including
the model calls, tool calls and the latest draft. ``quality_payload`` turns
the verdicts into the ``trip_plan_quality`` payload recorded on the Prefactor
agent instance.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from dataclasses import asdict, dataclass
from typing import Any

import httpx

DAILY_DRIVING_LIMIT_KM = 400
# Below this, the trip has more days than the drive needs.
MIN_DAILY_KM = 250

QUALITY_SCHEMA_NAME = "trip_plan_quality"
QUALITY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "passed": {"type": "boolean", "description": "Whether every judge passed"},
        "score": {
            "type": "integer",
            "minimum": 0,
            "maximum": 100,
            "description": "Share of judges that passed, out of 100",
        },
        "attempt": {"type": "integer", "description": "Draft attempt number"},
        "checks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "passed": {"type": "boolean"},
                    "detail": {"type": "string"},
                },
                "required": ["name", "passed", "detail"],
            },
        },
    },
    "required": ["passed", "score", "attempt", "checks"],
}

FINISHED_STATUSES = {"complete", "failed", "cancelled", "terminated"}
# Prefactor builds a judge's record from the spans it has moved to ClickHouse
# plus the buffered spans it has not moved yet. A span moved while it was still
# active shows as active until its finished version is moved too, which takes
# up to 2.5 seconds, so wait a little longer than that before asking.
FLUSH_SECONDS = 5
JUDGE_TIMEOUT_SECONDS = 300


@dataclass(frozen=True)
class Check:
    """One judge's verdict on a draft."""

    name: str
    passed: bool
    detail: str


class PrefactorJudges:
    """Asks the agent's Prefactor judges to score a running agent instance."""

    def __init__(
        self,
        api_url: str,
        api_token: str,
        poll_seconds: float = 2,
        flush_seconds: float = FLUSH_SECONDS,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Create the client.

        Args:
            api_url: Prefactor API URL, for example ``http://localhost:4000``.
            api_token: Prefactor API token.
            poll_seconds: How long to wait between status checks.
            flush_seconds: How long to wait before asking the judges, so that
                Prefactor has moved the spans to ClickHouse.
            transport: HTTP transport, for tests.
        """
        self._base_url = f"{api_url.rstrip('/')}/api/v1"
        self._headers = {"Authorization": f"Bearer {api_token}"}
        self._poll_seconds = poll_seconds
        self._flush_seconds = flush_seconds
        self._transport = transport

    async def __call__(self, instance_id: str) -> list[Check]:
        """Ask every judge of the instance's agent and wait for the verdicts.

        Args:
            instance_id: The running trip planner instance.

        Returns:
            One check per judge, named after the judge.
        """
        async with httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=30,
            transport=self._transport,
        ) as http:
            judges = await self._judges(http, instance_id)
            await asyncio.sleep(self._flush_seconds)
            return list(
                await asyncio.gather(
                    *(
                        self._ask(http, instance_id, judge_id, name)
                        for judge_id, name in judges
                    )
                )
            )

    async def _judges(
        self, http: httpx.AsyncClient, instance_id: str
    ) -> list[tuple[str, str]]:
        instance = await _details(
            http,
            f"/agent_instance/{instance_id}",
            params={"include_judges": "true"},
        )
        return [
            (judge["id"], judge["name"]) for judge in instance.get("judges") or []
        ]

    async def _ask(
        self, http: httpx.AsyncClient, instance_id: str, judge_id: str, name: str
    ) -> Check:
        response = await http.post(
            f"/agent_instance/{instance_id}/judge",
            json={"judge_agent_id": judge_id},
        )
        response.raise_for_status()
        run_id = response.json()["summary"]["id"]
        deadline = time.monotonic() + JUDGE_TIMEOUT_SECONDS
        status = "preparing"
        # A newer run leaves the previous judgement in place until it completes,
        # so this stays empty unless the run just started is complete.
        judgement: dict[str, Any] = {}
        while time.monotonic() < deadline:
            # A slow or dropped status check is retried on the next poll.
            with contextlib.suppress(httpx.TransportError):
                instance = await _details(
                    http,
                    f"/agent_instance/{instance_id}",
                    params={"include_judges": "true"},
                )
                judge = next(
                    (
                        item
                        for item in instance.get("judges") or []
                        if item["id"] == judge_id
                    ),
                    None,
                )
                latest = (judge or {}).get("latest_instance") or {}
                if latest.get("id") == run_id:
                    status = latest["status"]
                    if status in FINISHED_STATUSES:
                        if status == "complete":
                            judgement = (judge or {}).get("latest_judgement") or {}
                        break
            await asyncio.sleep(self._poll_seconds)
        if status != "complete" or "verdict" not in judgement:
            return Check(
                name, False, f"The judge gave no verdict (status {status})."
            )
        return Check(name, judgement["verdict"] == "pass", judgement["explanation"])


async def _details(
    http: httpx.AsyncClient, path: str, params: dict[str, str] | None = None
) -> dict[str, Any]:
    response = await http.get(path, params=params)
    response.raise_for_status()
    return response.json()["details"]


def quality_payload(checks: list[Check], attempt: int) -> dict[str, Any]:
    """Build the ``trip_plan_quality`` payload.

    Args:
        checks: Every judge's verdict on one draft.
        attempt: The draft attempt number, starting at 1.

    Returns:
        The quality payload.
    """
    passed = sum(check.passed for check in checks)
    return {
        "passed": passed == len(checks),
        "score": round(100 * passed / len(checks)) if checks else 0,
        "attempt": attempt,
        "checks": [asdict(check) for check in checks],
    }
