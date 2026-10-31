"""Application layer: combines the network, the store and the analytics engine."""
import time
import uuid
from collections import defaultdict
from typing import Callable

from . import config, engine
from .network import Network
from .store import Store

LEVEL_AZ = {"low": "Aşağı", "medium": "Orta", "high": "Yüksək", "unknown": "Məlumat yoxdur"}


class NotFound(Exception):
    pass


class InvalidInput(Exception):
    pass


class Conflict(Exception):
    pass


class RateLimited(Exception):
    def __init__(self, retry_after: int):
        super().__init__(f"Bu xətt üçün artıq bildiriş göndərmisiniz. {retry_after} saniyə sonra yenidən cəhd edin.")
        self.retry_after = retry_after


class TransitService:
    def __init__(self, store: Store, network: Network, clock: Callable[[], float] = time.time):
        self.store = store
        self.network = network
        self.clock = clock
        # bus_id -> time of the last real GPS fix; the simulator leaves these buses alone
        self._live: dict[str, float] = {}

    def is_live(self, bus_id: str, now: float | None = None) -> bool:
        now = self.clock() if now is None else now
        return now - self._live.get(bus_id, float("-inf")) <= config.LIVE_TTL_SEC

    # --- helpers ---------------------------------------------------------------
    def _route(self, route_id: str):
        route = self.network.route(route_id)
        if route is None:
            raise NotFound(f"Xətt tapılmadı: {route_id}")
        return route

    def _window_reports(self, now: float, route_id: str | None = None) -> list[dict]:
        return self.store.reports_since(now - config.WINDOW_SEC, route_id=route_id)

    def congestion(self, route_id: str, now: float | None = None) -> engine.Congestion:
        now = self.clock() if now is None else now
        rows = self._window_reports(now, route_id)
        return engine.compute_congestion([(r["level"], r["ts"]) for r in rows], now)

    def congestion_all(self, now: float) -> dict[str, engine.Congestion]:
        """Congestion of every line from a single query (hundreds of lines in the real network)."""
        by_route = defaultdict(list)
        for r in self._window_reports(now):
            by_route[r["route_id"]].append((r["level"], r["ts"]))
        return {rid: engine.compute_congestion(by_route.get(rid, []), now) for rid in self.network.routes}

    def _bus_crowd(self, now: float, route_id: str | None = None) -> dict[str, str]:
        by_bus = defaultdict(list)
        for r in self._window_reports(now, route_id):
            if r["bus_id"]:
                by_bus[r["bus_id"]].append((r["level"], r["ts"]))
        return {bid: engine.compute_congestion(rows, now).level for bid, rows in by_bus.items()}

    def _bus_view(self, bus: dict, route_level: str, crowd: dict[str, str]) -> dict:
        return {
            "id": bus["id"], "route_id": bus["route_id"], "plate": bus["plate"],
            "lat": round(bus["lat"], 6), "lon": round(bus["lon"], 6),
            "direction": bus["direction"], "speed_kmh": round(bus["speed_kmh"], 1),
            "updated_at": bus["updated_at"],
            "crowd_level": crowd.get(bus["id"], route_level),
            "live": self.is_live(bus["id"]),
        }

    # --- network -----------------------------------------------------------------
    def network_view(self) -> dict:
        return {
            "source": self.network.source,
            "routes": [
                {
                    "id": r.id, "number": r.number, "name": r.name, "color": r.color, "loop": r.loop,
                    "stops": r.stop_ids, "path": [list(p) for p in r.geometry.points],
                    "length_m": round(r.geometry.length),
                }
                for r in self.network.routes.values()
            ],
            "stops": [
                {"id": s.id, "name": s.name, "lat": s.lat, "lon": s.lon,
                 "routes": [r.id for r in self.network.routes_for_stop(s.id)]}
                for s in self.network.stops.values()
            ],
        }

    # --- fleet / GPS -----------------------------------------------------------------
    def seed_fleet(self) -> None:
        if self.store.count_buses() > 0:
            return
        now, plate_no, buses = self.clock(), 101, []
        for route in self.network.routes.values():
            for i in range(route.fleet):
                pos = route.geometry.length * i / route.fleet
                lat, lon = route.geometry.point_at(pos)
                buses.append({
                    "id": f"{route.id}-b{i + 1}", "route_id": route.id, "plate": f"BUS-{plate_no}",
                    "lat": lat, "lon": lon, "pos_m": pos,
                    "direction": 1 if route.loop or i % 2 == 0 else -1,
                    "speed_kmh": config.DEFAULT_SPEED_KMH, "updated_at": now,
                })
                plate_no += 1
        self.store.insert_buses(buses)

    def _place_bus(self, bus_id: str, route_id: str, plate: str, pos_m: float, direction: int,
                   speed_kmh: float, now: float) -> None:
        lat, lon = self.network.route(route_id).geometry.point_at(pos_m)
        self.store.upsert_bus({
            "id": bus_id, "route_id": route_id, "plate": plate, "lat": lat, "lon": lon,
            "pos_m": pos_m, "direction": direction, "speed_kmh": speed_kmh, "updated_at": now,
        })
        self.store.add_ping(bus_id, lat, lon, speed_kmh, now)

    def move_buses(self, moves: list[tuple[dict, float, int, float]]) -> None:
        """Simulator feed: (bus, position along route in metres, direction, speed)."""
        now, rows = self.clock(), []
        for bus, pos, direction, speed in moves:
            lat, lon = self.network.route(bus["route_id"]).geometry.point_at(pos)
            rows.append((lat, lon, pos, direction, speed, now, bus["id"]))
        self.store.update_positions(rows)

    def ingest_gps(self, bus_id: str, lat: float, lon: float, speed_kmh: float | None) -> dict:
        """Real GPS feed: snap the coordinate to the route, infer direction and speed."""
        bus = self.store.get_bus(bus_id)
        if bus is None:
            raise NotFound(f"Avtobus tapılmadı: {bus_id}")
        route = self._route(bus["route_id"])
        pos, offset = route.geometry.project(lat, lon)
        if offset > config.MAX_GPS_OFFSET_M:
            raise InvalidInput(f"GPS nöqtəsi marşrutdan {round(offset)} m uzaqdır")
        now = self.clock()
        moved = pos - bus["pos_m"]
        if route.loop:
            direction = 1
        else:
            direction = bus["direction"] if abs(moved) < 1 else (1 if moved > 0 else -1)
        if speed_kmh is None:
            dt = max(now - bus["updated_at"], 1e-6)
            speed_kmh = min(abs(moved) / dt * 3.6, 90)
        self.store.upsert_bus({**bus, "lat": lat, "lon": lon, "pos_m": pos, "direction": direction,
                               "speed_kmh": speed_kmh, "updated_at": now})
        self.store.add_ping(bus_id, lat, lon, speed_kmh, now)
        self._live[bus_id] = now
        return {"bus_id": bus_id, "pos_m": round(pos, 1), "snap_offset_m": round(offset, 1),
                "direction": direction}

    def track_from_phone(self, route_id: str, bus_id: str, lat: float, lon: float,
                         speed_kmh: float | None, accuracy_m: float | None) -> dict:
        """A passenger on board shares the phone location as the bus GPS."""
        self._route(route_id)
        bus = self.store.get_bus(bus_id)
        if bus is None or bus["route_id"] != route_id:
            raise InvalidInput("Avtobus bu xəttə aid deyil")
        if accuracy_m is not None and accuracy_m > config.MAX_GPS_ACCURACY_M:
            raise InvalidInput(f"GPS dəqiqliyi zəifdir ({round(accuracy_m)} m). Açıq yerdə yenidən cəhd edin.")
        try:
            return self.ingest_gps(bus_id, lat, lon, speed_kmh)
        except InvalidInput as exc:
            raise InvalidInput(f"Siz bu xəttin marşrutunda deyilsiniz: {exc}") from exc

    def buses(self, route_id: str | None = None) -> list[dict]:
        now = self.clock()
        if route_id:
            levels = {route_id: self.congestion(self._route(route_id).id, now).level}
        else:
            levels = {rid: c.level for rid, c in self.congestion_all(now).items()}
        crowd = self._bus_crowd(now, route_id)
        return [self._bus_view(b, levels.get(b["route_id"], "unknown"), crowd)
                for b in self.store.list_buses(route_id)]

    # --- passenger: ETA --------------------------------------------------------------
    def _eta(self, route, bus: dict, stop_id: str) -> tuple[int, float]:
        length, loop = route.geometry.length, route.loop
        dist = engine.travel_distance(bus["pos_m"], bus["direction"], route.stop_pos[stop_id], length, loop)
        between = sum(
            1 for sid, p in route.stop_pos.items()
            if sid != stop_id
            and 0 < engine.travel_distance(bus["pos_m"], bus["direction"], p, length, loop) < dist
        )
        return engine.eta_seconds(dist, bus["speed_kmh"], between), dist

    def route_live(self, route_id: str) -> dict:
        route = self._route(route_id)
        now = self.clock()
        cong = self.congestion(route_id, now)
        crowd = self._bus_crowd(now, route_id)
        buses = self.store.list_buses(route_id)
        stops = []
        for sid in route.stop_ids:
            best = min((self._eta(route, b, sid) + (b,) for b in buses), key=lambda x: x[0], default=None)
            stops.append({
                "id": sid, "name": self.network.stop(sid).name,
                "next_eta_sec": best[0] if best else None,
                "next_bus_id": best[2]["id"] if best else None,
            })
        return {
            "route_id": route_id,
            "congestion": cong.as_dict(),
            "buses": [self._bus_view(b, cong.level, crowd) for b in buses],
            "stops": stops,
        }

    def arrivals(self, stop_id: str, per_route: int = 2) -> dict:
        stop = self.network.stop(stop_id)
        if stop is None:
            raise NotFound(f"Dayanacaq tapılmadı: {stop_id}")
        now = self.clock()
        crowd = self._bus_crowd(now)
        items = []
        for route in self.network.routes_for_stop(stop_id):
            level = self.congestion(route.id, now).level
            etas = []
            for bus in self.store.list_buses(route.id):
                eta, dist = self._eta(route, bus, stop_id)
                view = self._bus_view(bus, level, crowd)
                etas.append({
                    "route_id": route.id, "number": route.number, "route_name": route.name,
                    "color": route.color, "bus_id": bus["id"], "plate": bus["plate"],
                    "lat": view["lat"], "lon": view["lon"],
                    "eta_sec": eta, "distance_m": round(dist), "crowd_level": view["crowd_level"],
                })
            items.extend(sorted(etas, key=lambda x: x["eta_sec"])[:per_route])
        items.sort(key=lambda x: x["eta_sec"])
        return {"stop": {"id": stop.id, "name": stop.name, "lat": stop.lat, "lon": stop.lon}, "arrivals": items}

    # --- crowdsourcing -----------------------------------------------------------------
    def submit_report(self, route_id: str, level: str, client_id: str, bus_id: str | None = None,
                      stop_id: str | None = None, source: str = "user", enforce_cooldown: bool = True,
                      evaluate: bool = True) -> dict:
        route = self._route(route_id)
        if level not in engine.LEVELS:
            raise InvalidInput("Sıxlıq səviyyəsi low, medium və ya high olmalıdır")
        if bus_id:
            bus = self.store.get_bus(bus_id)
            if bus is None or bus["route_id"] != route_id:
                raise InvalidInput("Avtobus bu xəttə aid deyil")
        if stop_id and stop_id not in route.stop_pos:
            raise InvalidInput("Dayanacaq bu xəttə aid deyil")
        now = self.clock()
        if enforce_cooldown:
            last = self.store.last_report_ts(client_id, route_id)
            if last is not None and now - last < config.REPORT_COOLDOWN_SEC:
                raise RateLimited(int(config.REPORT_COOLDOWN_SEC - (now - last)) + 1)
        report_id = self.store.add_report(route_id, level, client_id, now, bus_id, stop_id, source)
        alert = self.evaluate_route(route_id) if evaluate else None
        return {
            "id": report_id,
            "route_congestion": self.congestion(route_id, now).as_dict(),
            "alert_id": alert["id"] if alert else None,
        }

    # --- operator: analytics & anomaly alerts ---------------------------------------
    def evaluate_route(self, route_id: str, cong: engine.Congestion | None = None) -> dict | None:
        """Anomaly rule: if the line is confirmed 'high' within the last 10 minutes,
        open a reserve-bus recommendation (one open alert per line at a time)."""
        now = self.clock()
        cong = cong or self.congestion(route_id, now)
        if not engine.is_anomaly(cong):
            return None
        open_alert = self.store.open_alert(route_id)
        if open_alert:
            self.store.refresh_alert(open_alert["id"], cong.counts["high"], cong.total, cong.high_share, now)
            return self.store.get_alert(open_alert["id"])
        # After the operator acted, give the measure one window to take effect.
        closed = self.store.last_closed_alert(route_id)
        if closed and now - closed["closed_at"] < config.WINDOW_SEC:
            return None

        all_cong = self.congestion_all(now)
        donor = engine.pick_donor_route(route_id, all_cong, self.store.bus_counts())
        n = engine.recommended_reserve(cong)
        route = self.network.route(route_id)
        minutes = config.WINDOW_SEC // 60
        message = (f"{route.number} nömrəli xətt: son {minutes} dəqiqədə {cong.counts['high']} "
                   f"yüksək sıxlıq bildirişi ({round(cong.high_share * 100)}%). "
                   f"{n} əlavə avtobus ayrılması tövsiyə olunur.")
        if donor:
            message += f" Mənbə: {self.network.route(donor).number} nömrəli xətt (aşağı yüklənmə)."
        else:
            message += " Mənbə: depo ehtiyatı."
        alert_id = self.store.create_alert({
            "route_id": route_id, "now": now, "high_reports": cong.counts["high"],
            "total_reports": cong.total, "high_share": cong.high_share,
            "recommended_buses": n, "donor_route_id": donor, "message": message,
        })
        return self.store.get_alert(alert_id)

    def evaluate_all(self) -> None:
        for route_id, cong in self.congestion_all(self.clock()).items():
            if engine.is_anomaly(cong):
                self.evaluate_route(route_id, cong)

    def dispatch_alert(self, alert_id: int) -> dict:
        """Operator accepts the recommendation: move buses from the donor line
        (keeping at least one there) or release reserve buses from the depot."""
        alert = self.store.get_alert(alert_id)
        if alert is None:
            raise NotFound(f"Bildiriş tapılmadı: {alert_id}")
        if alert["status"] != "open":
            raise Conflict("Bu bildiriş artıq bağlanıb")
        now = self.clock()
        route_id, donor = alert["route_id"], alert["donor_route_id"]
        moved = []
        for _ in range(alert["recommended_buses"]):
            donor_buses = self.store.list_buses(donor) if donor else []
            if len(donor_buses) >= 2:
                bus_id, plate = donor_buses[-1]["id"], donor_buses[-1]["plate"]
            else:
                bus_id = f"reserve-{uuid.uuid4().hex[:6]}"
                plate = f"EHT-{self.store.count_buses() + 1}"
            self._place_bus(bus_id, route_id, plate, 0.0, 1, config.DEFAULT_SPEED_KMH, now)
            moved.append({"bus_id": bus_id, "plate": plate})
        plates = ", ".join(m["plate"] for m in moved)
        self.store.close_alert(alert_id, "dispatched", f"Xəttə yönləndirildi: {plates}", now)
        return {"alert": self.store.get_alert(alert_id), "dispatched": moved}

    def dismiss_alert(self, alert_id: int) -> dict:
        alert = self.store.get_alert(alert_id)
        if alert is None:
            raise NotFound(f"Bildiriş tapılmadı: {alert_id}")
        if alert["status"] != "open":
            raise Conflict("Bu bildiriş artıq bağlanıb")
        self.store.close_alert(alert_id, "dismissed", "Operator tərəfindən rədd edildi", self.clock())
        return {"alert": self.store.get_alert(alert_id)}

    def alerts(self, status: str | None, limit: int) -> list[dict]:
        out = []
        for a in self.store.list_alerts(status, limit):
            route = self.network.route(a["route_id"])
            donor = self.network.route(a["donor_route_id"]) if a["donor_route_id"] else None
            out.append({**a, "route_number": route.number, "route_name": route.name,
                        "color": route.color, "donor_number": donor.number if donor else None})
        return out

    def overview(self) -> dict:
        now = self.clock()
        cong_all = self.congestion_all(now)
        speeds = defaultdict(list)
        for b in self.store.list_buses():
            speeds[b["route_id"]].append(b["speed_kmh"])
        open_by_route = {a["route_id"]: a["id"] for a in self.store.list_alerts("open", 1000)}
        rows = []
        for route in self.network.routes.values():
            cong, sp = cong_all[route.id], speeds.get(route.id, [])
            rows.append({
                "id": route.id, "number": route.number, "name": route.name, "color": route.color,
                **cong.as_dict(),
                "level_az": LEVEL_AZ[cong.level],
                "buses": len(sp),
                "avg_speed_kmh": round(sum(sp) / len(sp), 1) if sp else None,
                "open_alert_id": open_by_route.get(route.id),
            })
        return {
            "generated_at": now,
            "window_minutes": config.WINDOW_SEC // 60,
            "totals": {
                "active_buses": sum(r["buses"] for r in rows),
                "live_buses": sum(1 for bid in list(self._live) if self.is_live(bid, now)),
                "routes": len(rows),
                "reports_window": sum(r["total_reports"] for r in rows),
                "open_alerts": len(open_by_route),
                "high_routes": sum(1 for r in rows if r["level"] == "high"),
            },
            "routes": rows,
        }

    def recent_reports(self, limit: int) -> list[dict]:
        out = []
        for r in self.store.recent_reports(limit):
            route = self.network.route(r["route_id"])
            stop = self.network.stop(r["stop_id"]) if r["stop_id"] else None
            out.append({**r, "route_number": route.number, "color": route.color,
                        "stop_name": stop.name if stop else None})
        return out

    def demo_rush(self, route_id: str, count: int = 6) -> dict:
        """Demo helper: inject a burst of 'high' reports from distinct passengers."""
        self._route(route_id)
        for _ in range(count):
            self.submit_report(route_id, "high", f"demo-{uuid.uuid4().hex[:8]}",
                               source="demo", enforce_cooldown=False)
        alert = self.store.open_alert(route_id)
        return {"route_id": route_id, "injected": count, "alert_id": alert["id"] if alert else None}
