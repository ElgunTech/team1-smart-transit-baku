"""Builds app/data/network.json from Baku open data (opendata.az):

  buslines.kmz      bus route geometries (one Placemark per line)
  dayanacaqlar.csv  bus stops: ID, AD (name), ID (code), LONGITUDE, LATITUDE, Tip

The CSV has no stop-to-route relation, so a stop is assigned to a route when it
lies within STOP_SNAP_M of the route polyline; stops are ordered by their
position along the line.

Usage:  python scripts/import_opendata.py <buslines.kmz> <dayanacaqlar.csv>
"""
import csv
import hashlib
import io
import json
import math
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from app.geo import haversine_m  # noqa: E402

OUT = ROOT / "app" / "data" / "network.json"
SIMPLIFY_M = 8          # Douglas-Peucker tolerance for route geometry
STOP_SNAP_M = 25        # max stop distance from the route line
MIN_STOP_GAP_M = 60     # merge stops closer than this along the same route
LOOP_GAP_M = 300        # start and end closer than this -> circular route
CELL_DEG = 0.002        # spatial grid cell (~170 x 220 m)
PALETTE = ["#c2410c", "#1d4ed8", "#0f766e", "#a16207", "#be123c", "#4d7c0f",
           "#0369a1", "#9a3412", "#7c2d12", "#115e59", "#b45309", "#1e40af"]

KX = math.cos(math.radians(40.4)) * 111_320  # metres per degree lon at Baku
KY = 110_540


def to_xy(lon, lat):
    return lon * KX, lat * KY


def simplify(points, tol):
    """Iterative Douglas-Peucker on (lon, lat) points."""
    if len(points) < 3:
        return points
    xy = [to_xy(*p) for p in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            # closed loops have identical endpoints: fall back to point distance
            d = abs(dy * (px - ax) - dx * (py - ay)) / norm if norm > 1e-6 else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(points, keep) if k]


def chain(parts):
    """Join several LineStrings into one by repeatedly attaching the nearest part."""
    parts = [p for p in parts if len(p) >= 2]
    line = max(parts, key=len)
    rest = [p for p in parts if p is not line]
    while rest:
        end = line[-1]
        best = min(rest, key=lambda p: min(haversine_m(end[1], end[0], p[0][1], p[0][0]),
                                           haversine_m(end[1], end[0], p[-1][1], p[-1][0])))
        rest.remove(best)
        if haversine_m(end[1], end[0], best[-1][1], best[-1][0]) < haversine_m(end[1], end[0], best[0][1], best[0][0]):
            best = best[::-1]
        line = line + best
    return line


def read_routes(kmz_path):
    with zipfile.ZipFile(kmz_path) as z:
        kml_name = next(n for n in z.namelist() if n.endswith(".kml"))
        root = ET.parse(io.BytesIO(z.read(kml_name))).getroot()
    ns = {"k": root.tag.split("}")[0].strip("{")}
    routes = {}
    for pm in root.findall(".//k:Placemark", ns):
        number = (pm.findtext("k:name", default="", namespaces=ns) or "").strip()
        parts = []
        for ls in pm.findall(".//k:LineString", ns):
            coords = [tuple(map(float, c.split(",")[:2])) for c in ls.findtext("k:coordinates", namespaces=ns).split()]
            parts.append(coords)
        if not number or not parts:
            continue
        line = chain(parts)
        # Two placemarks with the same number: keep the longer geometry.
        if number not in routes or len(line) > len(routes[number]):
            routes[number] = line
    return routes


def read_stops(csv_path):
    stops = {}
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        next(reader)
        for row in reader:
            if len(row) < 5:
                continue
            try:
                lon, lat = float(row[3]), float(row[4])
            except ValueError:
                continue
            code = row[2].strip() or row[0].strip()
            name = re.sub(r"\s+", " ", row[1].replace("“", "").replace("”", "").replace('"', "")).strip()
            stops[f"s{code}"] = {"id": f"s{code}", "name": name, "lat": round(lat, 6), "lon": round(lon, 6)}
    return stops


def cum_lengths(line):
    cum = [0.0]
    for (lo1, la1), (lo2, la2) in zip(line, line[1:]):
        cum.append(cum[-1] + haversine_m(la1, lo1, la2, lo2))
    return cum


def project(px, py, line_xy, seg_ids, cum):
    best = (float("inf"), 0.0)
    for i in seg_ids:
        (ax, ay), (bx, by) = line_xy[i], line_xy[i + 1]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = 0.0 if l2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / l2))
        off = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
        if off < best[0]:
            best = (off, cum[i] + t * (cum[i + 1] - cum[i]))
    return best


def cell(lon, lat):
    return int(lon / CELL_DEG), int(lat / CELL_DEG)


def main(kmz_path, csv_path):
    raw_routes = read_routes(kmz_path)
    stops = read_stops(csv_path)
    stop_grid = defaultdict(list)
    for s in stops.values():
        stop_grid[cell(s["lon"], s["lat"])].append(s)

    routes, used_stops = [], set()
    for number, line in raw_routes.items():
        line = simplify(line, SIMPLIFY_M)
        cum = cum_lengths(line)
        if cum[-1] < 500:
            continue
        line_xy = [to_xy(*p) for p in line]
        segs_by_cell = defaultdict(set)
        for i, ((lo1, la1), (lo2, la2)) in enumerate(zip(line, line[1:])):
            c1, c2 = cell(lo1, la1), cell(lo2, la2)
            for cx in range(min(c1[0], c2[0]) - 1, max(c1[0], c2[0]) + 2):
                for cy in range(min(c1[1], c2[1]) - 1, max(c1[1], c2[1]) + 2):
                    segs_by_cell[(cx, cy)].add(i)

        on_route = []
        for c, seg_ids in segs_by_cell.items():
            for s in stop_grid.get(c, ()):
                off, pos = project(*to_xy(s["lon"], s["lat"]), line_xy, seg_ids, cum)
                if off <= STOP_SNAP_M:
                    on_route.append((pos, s["id"]))
        on_route.sort()
        ordered, last_pos, seen = [], -1e9, set()
        for pos, sid in on_route:
            if sid in seen or pos - last_pos < MIN_STOP_GAP_M:
                continue
            ordered.append([sid, round(pos, 1)])
            seen.add(sid)
            last_pos = pos
        if len(ordered) < 2:
            continue
        used_stops.update(seen)

        start, end = line[0], line[-1]
        loop = haversine_m(start[1], start[0], end[1], end[0]) < LOOP_GAP_M
        color = PALETTE[int(hashlib.md5(number.encode()).hexdigest(), 16) % len(PALETTE)]
        first, last = stops[ordered[0][0]]["name"], stops[ordered[-1][0]]["name"]
        routes.append({
            "id": f"r{number}",
            "number": number,
            "name": f"{first} – {last}" if first != last else first,
            "color": color,
            "loop": loop,
            "length_m": round(cum[-1]),
            "path": [[round(lat, 5), round(lon, 5)] for lon, lat in line],
            "stops": ordered,
        })

    def sort_key(r):
        m = re.match(r"(\d+)(.*)", r["number"])
        return (int(m.group(1)), m.group(2)) if m else (10_000, r["number"])

    routes.sort(key=sort_key)
    data = {
        "source": "opendata.az — Bakı avtobus xətləri (buslines.kmz) və dayanacaqlar (dayanacaqlar.csv)",
        "routes": routes,
        "stops": [stops[sid] for sid in sorted(used_stops)],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    loops = sum(r["loop"] for r in routes)
    print(f"routes: {len(routes)} (loops: {loops}) of {len(raw_routes)}; stops used: {len(used_stops)} of {len(stops)}")
    print(f"points: {sum(len(r['path']) for r in routes)}; avg stops/route: "
          f"{sum(len(r['stops']) for r in routes) / len(routes):.1f}; size: {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
