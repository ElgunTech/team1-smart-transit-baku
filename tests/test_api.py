import itertools

import pytest
from fastapi.testclient import TestClient

from app import auth, config
from app.main import create_app
from app.network import ROUTES, build_demo_network


class FakeClock:
    def __init__(self, t: float = 1_000_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t

    def advance(self, sec: float) -> None:
        self.t += sec


@pytest.fixture(autouse=True)
def fast_hashing(monkeypatch):
    monkeypatch.setattr(auth, "ITERATIONS", 1_000)


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def client(tmp_path, clock):
    app = create_app(str(tmp_path / "test.db"), simulate=False, clock=clock, network=build_demo_network())
    with TestClient(app) as c:
        yield c


_ids = itertools.count()


def new_passenger(client) -> dict:
    n = next(_ids)
    res = client.post("/api/auth/register",
                      json={"name": f"Sərnişin {n}", "email": f"user{n}@test.az", "password": "secret1"})
    assert res.status_code == 201
    return {"Authorization": f"Bearer {res.json()['token']}"}


@pytest.fixture
def pax(client):
    return new_passenger(client)


@pytest.fixture
def ops(client):
    res = client.post("/api/auth/login",
                      json={"email": config.OPERATOR_EMAIL, "password": config.OPERATOR_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['token']}"}


def report(client, headers, route_id="r1", level="high", **extra):
    return client.post("/api/reports", json={"route_id": route_id, "level": level, **extra}, headers=headers)


def flood(client, route_id="r1", n=3, level="high"):
    """n reports from n distinct passengers."""
    for _ in range(n):
        assert report(client, new_passenger(client), route_id, level).status_code == 201


def open_alerts(client, ops):
    return client.get("/api/operator/alerts", params={"status": "open"}, headers=ops).json()


# --- auth ---------------------------------------------------------------------------------
def test_register_login_me_logout(client):
    res = client.post("/api/auth/register", json={"name": "Elgün", "email": "Elgun@Test.az", "password": "secret1"})
    assert res.status_code == 201
    assert res.json()["user"]["role"] == "passenger"
    login = client.post("/api/auth/login", json={"email": "elgun@test.az", "password": "secret1"})
    headers = {"Authorization": f"Bearer {login.json()['token']}"}
    assert client.get("/api/auth/me", headers=headers).json()["email"] == "elgun@test.az"
    assert client.post("/api/auth/logout", headers=headers).status_code == 204
    assert client.get("/api/auth/me", headers=headers).status_code == 401


@pytest.mark.parametrize("payload, status", [
    ({"name": "A", "email": "a@test.az", "password": "secret1"}, 422),
    ({"name": "Ali", "email": "not-an-email", "password": "secret1"}, 422),
    ({"name": "Ali", "email": "a@test.az", "password": "123"}, 422),
])
def test_register_validation(client, payload, status):
    assert client.post("/api/auth/register", json=payload).status_code == status


def test_duplicate_email_and_wrong_password(client):
    body = {"name": "Ali", "email": "ali@test.az", "password": "secret1"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    assert client.post("/api/auth/register", json=body).status_code == 409
    assert client.post("/api/auth/login", json={"email": "ali@test.az", "password": "wrong!"}).status_code == 401


def test_password_is_hashed(client):
    client.post("/api/auth/register", json={"name": "Ali", "email": "ali@test.az", "password": "secret1"})
    stored = client.app.state.service.store.get_user_by_email("ali@test.az")["password_hash"]
    assert "secret1" not in stored and stored.startswith("pbkdf2$")


def test_roles_are_enforced(client, pax, ops):
    assert client.get("/api/buses").status_code == 401
    assert client.get("/api/operator/overview").status_code == 401
    assert client.get("/api/operator/overview", headers=pax).status_code == 403
    assert client.post("/api/demo/rush/r1", headers=pax).status_code == 403
    assert client.get("/api/operator/overview", headers=ops).status_code == 200


# --- passenger module -----------------------------------------------------------------------
def test_network_and_fleet(client, pax):
    net = client.get("/api/network", headers=pax).json()
    assert len(net["routes"]) == 4
    assert all(len(r["path"]) >= 2 for r in net["routes"])
    assert len(client.get("/api/buses", headers=pax).json()) == sum(spec["fleet"] for spec in ROUTES)


def test_report_is_accepted_and_updates_level(client, pax):
    res = report(client, pax, level="medium")
    assert res.status_code == 201
    assert res.json()["route_congestion"]["level"] == "medium"


@pytest.mark.parametrize("payload, status", [
    ({"route_id": "r1", "level": "extreme"}, 422),
    ({"route_id": "nope", "level": "high"}, 404),
    ({"route_id": "r1", "level": "high", "bus_id": "r5-b1"}, 422),
    ({"route_id": "r1", "level": "high", "stop_id": "memar"}, 422),
])
def test_report_validation(client, pax, payload, status):
    assert client.post("/api/reports", json=payload, headers=pax).status_code == status


def test_report_requires_login(client):
    assert client.post("/api/reports", json={"route_id": "r1", "level": "high"}).status_code == 401


def test_report_cooldown_per_passenger(client, pax, clock):
    assert report(client, pax).status_code == 201
    second = report(client, pax)
    assert second.status_code == 429
    assert int(second.headers["Retry-After"]) > 0
    assert report(client, pax, route_id="r5").status_code == 201  # other line is fine
    clock.advance(config.REPORT_COOLDOWN_SEC + 1)
    assert report(client, pax).status_code == 201


def test_arrivals_sorted_and_route_live(client, pax):
    data = client.get("/api/stops/may28/arrivals", headers=pax).json()
    etas = [a["eta_sec"] for a in data["arrivals"]]
    assert etas == sorted(etas) and etas
    assert {a["route_id"] for a in data["arrivals"]} == {"r1", "r13"}
    live = client.get("/api/routes/r1/live", headers=pax).json()
    assert len(live["stops"]) == 6
    assert all(s["next_eta_sec"] is not None for s in live["stops"])
    assert client.get("/api/stops/nowhere/arrivals", headers=pax).status_code == 404


def test_gps_ingest_snaps_to_route(client, pax):
    # a point near "Gənclik" on line 1
    res = client.post("/api/gps", json={"bus_id": "r1-b1", "lat": 40.4005, "lon": 49.8521, "speed_kmh": 20})
    assert res.status_code == 202
    assert res.json()["snap_offset_m"] < 50
    bus = next(b for b in client.get("/api/buses", params={"route_id": "r1"}, headers=pax).json() if b["id"] == "r1-b1")
    assert bus["lat"] == pytest.approx(40.4005)


def test_gps_rejects_far_points_and_unknown_bus(client):
    assert client.post("/api/gps", json={"bus_id": "r1-b1", "lat": 40.50, "lon": 49.70}).status_code == 422
    assert client.post("/api/gps", json={"bus_id": "ghost", "lat": 40.4, "lon": 49.85}).status_code == 404


def tracking(client, headers, **extra):
    body = {"route_id": "r1", "bus_id": "r1-b1", "lat": 40.4005, "lon": 49.8521, "accuracy_m": 15, **extra}
    return client.post("/api/tracking", json=body, headers=headers)


def test_phone_tracking_makes_bus_live(client, pax, clock):
    assert tracking(client, {}).status_code == 401
    res = tracking(client, pax)
    assert res.status_code == 202
    bus = next(b for b in client.get("/api/buses", params={"route_id": "r1"}, headers=pax).json() if b["id"] == "r1-b1")
    assert bus["live"] is True and bus["lat"] == pytest.approx(40.4005)
    clock.advance(config.LIVE_TTL_SEC + 1)
    bus = next(b for b in client.get("/api/buses", params={"route_id": "r1"}, headers=pax).json() if b["id"] == "r1-b1")
    assert bus["live"] is False


@pytest.mark.parametrize("extra", [
    {"accuracy_m": 900},                       # too imprecise
    {"lat": 40.50, "lon": 49.70},              # not on the route
    {"bus_id": "r5-b1"},                       # bus of another line
])
def test_phone_tracking_rejects_bad_fixes(client, pax, extra):
    assert tracking(client, pax, **extra).status_code == 422


def test_simulator_does_not_move_live_bus(client, pax):
    from app.simulator import Simulator
    tracking(client, pax)
    svc = client.app.state.service
    before = svc.store.get_bus("r1-b1")["pos_m"]
    Simulator(svc).step(2)
    assert svc.store.get_bus("r1-b1")["pos_m"] == before


# --- operator module: anomaly alerts ---------------------------------------------------------
def test_anomaly_creates_single_alert_with_donor(client, ops):
    flood(client, "r5", n=3, level="low")       # r5 is quiet -> can lend a bus
    flood(client, "r1", n=2)
    assert open_alerts(client, ops) == []
    flood(client, "r1", n=2)
    alerts = open_alerts(client, ops)
    assert len(alerts) == 1
    assert alerts[0]["route_id"] == "r1"
    assert alerts[0]["donor_route_id"] == "r5"
    flood(client, "r1", n=2)                     # more reports refresh, do not duplicate
    assert len(open_alerts(client, ops)) == 1


def test_alert_needs_reports_within_window(client, ops, clock):
    flood(client, "r1", n=2)
    clock.advance(config.WINDOW_SEC + 1)         # first two expire
    flood(client, "r1", n=2)
    assert open_alerts(client, ops) == []


def test_dispatch_moves_bus_from_donor(client, ops):
    flood(client, "r5", n=3, level="low")
    flood(client, "r1", n=3)
    alert = open_alerts(client, ops)[0]
    before = client.get("/api/operator/overview", headers=ops).json()["routes"]
    res = client.post(f"/api/operator/alerts/{alert['id']}/dispatch", headers=ops)
    assert res.status_code == 200
    after = client.get("/api/operator/overview", headers=ops).json()["routes"]
    count = lambda rows, rid: next(r["buses"] for r in rows if r["id"] == rid)
    assert count(after, "r1") == count(before, "r1") + alert["recommended_buses"]
    assert count(after, "r5") == count(before, "r5") - alert["recommended_buses"]
    assert res.json()["alert"]["status"] == "dispatched"
    assert client.post(f"/api/operator/alerts/{alert['id']}/dispatch", headers=ops).status_code == 409


def test_dispatch_without_donor_uses_depot(client, ops):
    flood(client, "r1", n=3)
    alert = open_alerts(client, ops)[0]
    assert alert["donor_route_id"] is None
    res = client.post(f"/api/operator/alerts/{alert['id']}/dispatch", headers=ops).json()
    assert res["dispatched"][0]["bus_id"].startswith("reserve-")


def test_no_new_alert_right_after_operator_action(client, ops, clock):
    flood(client, "r1", n=3)
    alert = open_alerts(client, ops)[0]
    client.post(f"/api/operator/alerts/{alert['id']}/dismiss", headers=ops)
    flood(client, "r1", n=3)
    assert open_alerts(client, ops) == []
    clock.advance(config.WINDOW_SEC + 1)
    flood(client, "r1", n=3)
    assert len(open_alerts(client, ops)) == 1


def test_demo_rush_triggers_alert(client, ops):
    assert client.post("/api/demo/rush/r13", headers=ops).json()["alert_id"] is not None
