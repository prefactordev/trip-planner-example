"""Tests for the trip planner graph's structured results.

Run from the repository root:
    mise run test packages/langchain/examples/trip_planner/test_graph.py
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from graph import RoutePlan, driving_days

ROUTE = {
    "origin_found": "Melbourne, Victoria, Australia",
    "destination_found": "Adelaide, South Australia, Australia",
    "distance_km": 726,
    "duration_hours": 9.2,
}
STOP = {"name": "Horsham", "lat": -36.7, "lon": 142.2, "km_from_start": 300}


def stop(name: str, km_from_start: float) -> dict[str, object]:
    return {"name": name, "lat": -36.0, "lon": 142.0, "km_from_start": km_from_start}


def test_route_plan_needs_two_stops_when_there_is_no_problem():
    with pytest.raises(ValidationError, match="at least 2 stops"):
        RoutePlan.model_validate({**ROUTE, "stops": [STOP]})


def test_route_plan_allows_no_stops_when_it_explains_the_problem():
    plan = RoutePlan.model_validate(
        {**ROUTE, "stops": [], "problem": "No driving route found: NoRoute"}
    )

    assert plan.stops == []


def test_route_plan_allows_at_most_six_stops():
    with pytest.raises(ValidationError):
        RoutePlan.model_validate({**ROUTE, "stops": [STOP] * 7})


def test_route_plan_rejects_stops_more_than_a_days_drive_apart():
    stops = [stop("Dimboola", 320), stop("Adelaide", 726)]

    with pytest.raises(ValidationError, match="406 km"):
        RoutePlan.model_validate({**ROUTE, "stops": stops})


def test_route_plan_rejects_a_first_stop_more_than_a_days_drive_away():
    stops = [stop("Keith", 480), stop("Adelaide", 726)]

    with pytest.raises(ValidationError, match="480 km"):
        RoutePlan.model_validate({**ROUTE, "stops": stops})


@pytest.mark.parametrize(
    ("km_from_start", "expected_days"),
    [
        # Dimboola, Keith, Adelaide: the distance alone suggests 2 days, but
        # neither split keeps both days within 400 km.
        ([320, 480, 726], 3),
        ([300, 600, 900, 1200, 1500, 1762], 6),
        ([390, 780], 2),
        ([150], 1),
    ],
)
def test_driving_days_counts_the_days_the_stops_need(km_from_start, expected_days):
    assert driving_days(km_from_start) == expected_days
