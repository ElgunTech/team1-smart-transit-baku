"""Static transit network: stops and routes.

By default the real Baku network from opendata.az is loaded (app/data/network.json,
built by scripts/import_opendata.py). A small demo network is kept for tests.
"""
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

from .geo import RouteGeometry

OPENDATA_PATH = Path(__file__).resolve().parent / "data" / "network.json"

# Approximate coordinates of well-known stops. Route numbers are demo values.
STOPS = [
    ("icherisheher", "İçərişəhər", 40.3661, 49.8318),
    ("sahil", "Sahil", 40.3717, 49.8443),
    ("may28", "28 May", 40.3797, 49.8486),
    ("genclik", "Gənclik", 40.4006, 49.8519),
    ("narimanov", "Nərimanov", 40.4029, 49.8711),
    ("koroglu", "Koroğlu", 40.4210, 49.9180),
    ("nizami", "Nizami", 40.3796, 49.8302),
    ("elmler", "Elmlər Akademiyası", 40.3752, 49.8146),
    ("inshaatchilar", "İnşaatçılar", 40.3910, 49.8030),
    ("yanvar20", "20 Yanvar", 40.4040, 49.8080),
    ("memar", "Memar Əcəmi", 40.4115, 49.8130),
    ("nasimi", "Nəsimi", 40.4245, 49.8237),
    ("azadliq", "Azadlıq prospekti", 40.4255, 49.8430),
    ("xatai", "Xətai", 40.3830, 49.8720),
    ("haec", "Heydər Əliyev Mərkəzi", 40.3959, 49.8678),
]

# `profile` drives the simulated crowd reports: how likely each level is on that line.
ROUTES = [
    {
        "id": "r1", "number": "1", "name": "İçərişəhər – Koroğlu", "color": "#c2410c", "fleet": 3,
        "stops": ["icherisheher", "sahil", "may28", "genclik", "narimanov", "koroglu"],
        "profile": {"low": 0.15, "medium": 0.45, "high": 0.40},
    },
    {
        "id": "r5", "number": "5", "name": "Elmlər Akademiyası – Azadlıq pr.", "color": "#1d4ed8", "fleet": 3,
        "stops": ["elmler", "inshaatchilar", "yanvar20", "memar", "nasimi", "azadliq"],
        "profile": {"low": 0.70, "medium": 0.25, "high": 0.05},
    },
    {
        "id": "r13", "number": "13", "name": "Nizami – Nərimanov", "color": "#0f766e", "fleet": 2,
        "stops": ["nizami", "may28", "xatai", "haec", "narimanov"],
        "profile": {"low": 0.35, "medium": 0.45, "high": 0.20},
    },
    {
        "id": "r88", "number": "88", "name": "İçərişəhər – 20 Yanvar", "color": "#a16207", "fleet": 2,
        "stops": ["icherisheher", "nizami", "elmler", "inshaatchilar", "yanvar20"],
        "profile": {"low": 0.30, "medium": 0.50, "high": 0.20},
    },
]


@dataclass(frozen=True)
class Stop:
    id: str
    name: str
    lat: float
    lon: float


@dataclass
class Route:
    id: str
    number: str
    name: str
    color: str
    fleet: int
    stop_ids: list[str]
    geometry: RouteGeometry
    profile: dict[str, float]
    stop_pos: dict[str, float] = field(default_factory=dict)
    loop: bool = False  # circular line: buses keep going forward and wrap around


class Network:
    def __init__(self, stops: list[Stop], routes: list[Route], source: str = "demo"):
        self.stops = {s.id: s for s in stops}
        self.routes = {r.id: r for r in routes}
        self.source = source
        self._by_stop: dict[str, list[Route]] = {}
        for r in routes:
            for sid in r.stop_ids:
                self._by_stop.setdefault(sid, []).append(r)

    def route(self, route_id: str) -> Route | None:
        return self.routes.get(route_id)

    def stop(self, stop_id: str) -> Stop | None:
        return self.stops.get(stop_id)

    def routes_for_stop(self, stop_id: str) -> list[Route]:
        return self._by_stop.get(stop_id, [])


# Simulated crowd profiles for open-data lines: a few busy lines, many quiet ones.
PROFILES = {
    "busy": {"low": 0.10, "medium": 0.40, "high": 0.50},
    "normal": {"low": 0.35, "medium": 0.45, "high": 0.20},
    "quiet": {"low": 0.70, "medium": 0.25, "high": 0.05},
}


def _profile_for(number: str) -> dict[str, float]:
    bucket = int(hashlib.md5(number.encode()).hexdigest(), 16) % 100
    if bucket < 7:
        return PROFILES["busy"]
    if bucket < 50:
        return PROFILES["quiet"]
    return PROFILES["normal"]


def load_opendata_network(path: Path = OPENDATA_PATH) -> Network:
    """Real Baku network produced by scripts/import_opendata.py."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    stops = [Stop(s["id"], s["name"], s["lat"], s["lon"]) for s in data["stops"]]
    routes = []
    for spec in data["routes"]:
        geometry = RouteGeometry([tuple(p) for p in spec["path"]])
        stop_ids = [sid for sid, _ in spec["stops"]]
        routes.append(Route(
            id=spec["id"], number=spec["number"], name=spec["name"], color=spec["color"],
            fleet=max(2, min(5, round(geometry.length / 7000))),
            stop_ids=stop_ids, geometry=geometry, profile=_profile_for(spec["number"]),
            stop_pos={sid: min(pos, geometry.length) for sid, pos in spec["stops"]},
            loop=spec["loop"],
        ))
    return Network(stops, routes, source="opendata.az")


def build_default_network() -> Network:
    if OPENDATA_PATH.exists():
        return load_opendata_network()
    return build_demo_network()


def build_demo_network() -> Network:
    """Small hand-made network; used by the tests and as a fallback."""
    stops = [Stop(*s) for s in STOPS]
    by_id = {s.id: s for s in stops}
    routes = []
    for spec in ROUTES:
        points = [(by_id[sid].lat, by_id[sid].lon) for sid in spec["stops"]]
        geometry = RouteGeometry(points)
        route = Route(
            id=spec["id"], number=spec["number"], name=spec["name"], color=spec["color"],
            fleet=spec["fleet"], stop_ids=list(spec["stops"]), geometry=geometry,
            profile=spec["profile"],
        )
        # Stops are the polyline vertices, so their positions are the cumulative distances.
        route.stop_pos = dict(zip(spec["stops"], geometry.cum))
        routes.append(route)
    return Network(stops, routes)
