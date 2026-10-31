"""The real Baku network (opendata.az) loads and runs end-to-end."""
import random

import pytest

from app import engine
from app.network import OPENDATA_PATH, load_opendata_network
from app.services import TransitService
from app.simulator import Simulator
from app.store import Store

pytestmark = pytest.mark.skipif(not OPENDATA_PATH.exists(), reason="network.json not generated")


@pytest.fixture(scope="module")
def network():
    return load_opendata_network()


def test_network_is_real_scale(network):
    assert len(network.routes) >= 200
    assert len(network.stops) >= 3000
    for route in network.routes.values():
        assert len(route.stop_ids) >= 2
        positions = [route.stop_pos[s] for s in route.stop_ids]
        assert positions == sorted(positions)
        assert 0 <= positions[-1] <= route.geometry.length + 1


def test_stops_lie_on_their_routes(network):
    route = next(iter(network.routes.values()))
    for sid in route.stop_ids[:10]:
        stop = network.stop(sid)
        _, offset = route.geometry.project(stop.lat, stop.lon)
        assert offset < 30


def test_loop_travel_distance_wraps():
    assert engine.travel_distance(900, 1, 100, 1000, loop=True) == 200
    assert engine.travel_distance(100, 1, 900, 1000, loop=True) == 800


def test_simulation_and_eta_on_real_network(network, tmp_path):
    svc = TransitService(Store(str(tmp_path / "real.db")), network)
    svc.seed_fleet()
    sim = Simulator(svc, rng=random.Random(1))
    sim.backfill_reports()
    for _ in range(3):
        sim.step(2)
    route = next(r for r in network.routes.values() if r.loop)
    live = svc.route_live(route.id)
    assert all(s["next_eta_sec"] is not None for s in live["stops"])
    overview = svc.overview()
    assert overview["totals"]["routes"] == len(network.routes)
    assert overview["totals"]["active_buses"] > 400
