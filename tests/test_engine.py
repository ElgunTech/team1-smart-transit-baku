import pytest

from app import engine
from app.geo import RouteGeometry, haversine_m

NOW = 1_000_000.0
WINDOW = 600


def reports(*levels, age=60):
    return [(lvl, NOW - age) for lvl in levels]


def test_no_reports_is_unknown():
    c = engine.compute_congestion([], NOW, WINDOW)
    assert c.level == "unknown" and c.score is None and c.total == 0


@pytest.mark.parametrize("levels, expected", [
    (["low", "low", "low"], "low"),
    (["medium", "medium", "low", "high"], "medium"),
    (["high", "high", "high", "medium"], "high"),
])
def test_congestion_level(levels, expected):
    assert engine.compute_congestion(reports(*levels), NOW, WINDOW).level == expected


def test_reports_outside_window_are_ignored():
    old = [("high", NOW - WINDOW - 1)] * 10
    c = engine.compute_congestion(old + reports("low"), NOW, WINDOW)
    assert c.total == 1 and c.level == "low"


def test_future_timestamps_are_ignored():
    c = engine.compute_congestion([("high", NOW + 30)], NOW, WINDOW)
    assert c.total == 0


def test_newer_reports_weigh_more():
    mixed = [("high", NOW - 10), ("low", NOW - 590)]
    assert engine.compute_congestion(mixed, NOW, WINDOW).score > 2


def test_anomaly_needs_enough_high_reports():
    two = engine.compute_congestion(reports("high", "high"), NOW, WINDOW)
    three = engine.compute_congestion(reports("high", "high", "high"), NOW, WINDOW)
    assert not engine.is_anomaly(two, min_high=3, share=0.6)
    assert engine.is_anomaly(three, min_high=3, share=0.6)


def test_anomaly_needs_majority():
    split = engine.compute_congestion(reports("high", "high", "high", "low", "low", "low"), NOW, WINDOW)
    assert not engine.is_anomaly(split, min_high=3, share=0.6)


def test_recommended_reserve():
    mild = engine.compute_congestion(reports("high", "high", "high", "medium"), NOW, WINDOW)
    severe = engine.compute_congestion(reports(*["high"] * 6), NOW, WINDOW)
    assert engine.recommended_reserve(mild, min_high=3) == 1
    assert engine.recommended_reserve(severe, min_high=3) == 2


def test_donor_is_low_route_with_spare_bus():
    cong = {
        "a": engine.compute_congestion(reports("high"), NOW, WINDOW),
        "b": engine.compute_congestion(reports("low", "low"), NOW, WINDOW),
        "c": engine.compute_congestion(reports("low"), NOW, WINDOW),
        "d": engine.compute_congestion([], NOW, WINDOW),
    }
    counts = {"a": 3, "b": 3, "c": 1, "d": 5}
    # c has a single bus, d has no confirmed low load, a is the target itself
    assert engine.pick_donor_route("a", cong, counts) == "b"
    assert engine.pick_donor_route("a", cong, {"a": 3, "b": 1, "c": 1, "d": 5}) is None


@pytest.mark.parametrize("pos, direction, target, expected", [
    (100, 1, 400, 300),     # ahead, moving towards it
    (400, 1, 100, 1500),    # behind: drive to the terminal (600 m) and back (900 m)
    (400, -1, 100, 300),    # moving back towards it
    (100, -1, 400, 500),    # behind: back to start, then forward
])
def test_travel_distance(pos, direction, target, expected):
    assert engine.travel_distance(pos, direction, target, 1000) == expected


def test_eta_includes_dwell_and_default_speed():
    assert engine.eta_seconds(3600, 36, 0, dwell_sec=20) == 360
    assert engine.eta_seconds(3600, 36, 2, dwell_sec=20) == 400
    # a stopped bus falls back to the default speed instead of an infinite ETA
    assert engine.eta_seconds(1000, 0, 0) > 0


def test_geometry_point_and_projection_round_trip():
    g = RouteGeometry([(40.37, 49.83), (40.38, 49.85), (40.40, 49.85)])
    assert g.length == pytest.approx(haversine_m(40.37, 49.83, 40.38, 49.85) + haversine_m(40.38, 49.85, 40.40, 49.85))
    lat, lon = g.point_at(1500)
    pos, offset = g.project(lat, lon)
    assert pos == pytest.approx(1500, abs=15)
    assert offset < 5
