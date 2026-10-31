"""Demo data source: moves buses along their real routes (acting as a GPS feed)
and submits passenger reports according to each line's crowd profile."""
import asyncio
import logging
import random
import uuid

from . import config
from .services import TransitService

log = logging.getLogger("simulator")

# Crowded lines move slower, which also makes ETAs longer.
SPEED_BY_LEVEL = {"low": 24.0, "medium": 18.0, "high": 12.0, "unknown": 20.0}


class Simulator:
    def __init__(self, service: TransitService, rng: random.Random | None = None,
                 reports_per_tick: float = 1.5):
        self.service = service
        self.rng = rng or random.Random()
        self.reports_per_tick = reports_per_tick
        self._ticks = 0

    def _pick_level(self, profile: dict[str, float]) -> str:
        return self.rng.choices(list(profile), weights=list(profile.values()))[0]

    def backfill_reports(self, per_route: int = 3) -> None:
        """Give each line some history so the dashboards are not empty on start."""
        store, now = self.service.store, self.service.clock()
        for route in self.service.network.routes.values():
            for _ in range(per_route):
                ts = now - self.rng.uniform(30, config.WINDOW_SEC - 60)
                store.add_report(route.id, self._pick_level(route.profile),
                                 f"sim-{uuid.uuid4().hex[:8]}", ts, source="sim")

    def step(self, dt: float) -> None:
        svc = self.service
        levels = {rid: c.level for rid, c in svc.congestion_all(svc.clock()).items()}
        moves = []
        buses = svc.store.list_buses()
        for bus in buses:
            route = svc.network.route(bus["route_id"])
            if route is None or svc.is_live(bus["id"]):
                continue  # buses with a real GPS fix are not simulated
            target = SPEED_BY_LEVEL[levels.get(route.id, "unknown")] * self.rng.uniform(0.8, 1.2)
            speed = bus["speed_kmh"] * 0.7 + target * 0.3
            direction = bus["direction"]
            pos = bus["pos_m"] + direction * speed / 3.6 * dt
            length = route.geometry.length
            if route.loop:
                pos, direction = pos % length, 1
            elif pos >= length:
                pos, direction = length - (pos - length), -1
            elif pos <= 0:
                pos, direction = -pos, 1
            moves.append((bus, pos, direction, speed))
        svc.move_buses(moves)

        # Poisson-like number of passenger reports this tick
        n = int(self.reports_per_tick) + (self.rng.random() < self.reports_per_tick % 1)
        by_route = {}
        for b in buses:
            by_route.setdefault(b["route_id"], []).append(b)
        for _ in range(n):
            route = self.rng.choice(list(svc.network.routes.values()))
            bus = self.rng.choice(by_route.get(route.id) or [None])
            stop_id = self.rng.choice(route.stop_ids)
            svc.submit_report(route.id, self._pick_level(route.profile), f"sim-{uuid.uuid4().hex[:8]}",
                              bus_id=bus["id"] if bus else None, stop_id=stop_id,
                              source="sim", enforce_cooldown=False, evaluate=False)

        if self._ticks % 5 == 0:
            svc.evaluate_all()
        self._ticks += 1
        if self._ticks % 300 == 0:
            svc.store.prune_pings(svc.clock() - 3600)

    async def run(self, tick: float = config.SIM_TICK_SEC) -> None:
        while True:
            try:
                await asyncio.to_thread(self.step, tick)
            except Exception:  # keep the feed alive; one bad tick must not stop the demo
                log.exception("simulator tick failed")
            await asyncio.sleep(tick)
