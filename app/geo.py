"""Geometry helpers: distances and positions along a route polyline."""
import math

EARTH_RADIUS_M = 6_371_000.0


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


class RouteGeometry:
    """A polyline with cumulative distances, so a bus can be described by
    a single number: metres travelled from the first stop."""

    def __init__(self, points: list[tuple[float, float]]):
        if len(points) < 2:
            raise ValueError("route needs at least two points")
        self.points = points
        self.cum = [0.0]
        for a, b in zip(points, points[1:]):
            self.cum.append(self.cum[-1] + haversine_m(*a, *b))
        self.length = self.cum[-1]

    def point_at(self, pos_m: float) -> tuple[float, float]:
        pos_m = max(0.0, min(pos_m, self.length))
        for i in range(len(self.points) - 1):
            if pos_m <= self.cum[i + 1]:
                seg = self.cum[i + 1] - self.cum[i]
                t = 0.0 if seg == 0 else (pos_m - self.cum[i]) / seg
                (la1, lo1), (la2, lo2) = self.points[i], self.points[i + 1]
                return la1 + (la2 - la1) * t, lo1 + (lo2 - lo1) * t
        return self.points[-1]

    def project(self, lat: float, lon: float) -> tuple[float, float]:
        """Snap a GPS coordinate onto the route.
        Returns (position along route in metres, distance from route in metres)."""
        # Local equirectangular projection is accurate enough at city scale.
        kx = math.cos(math.radians(lat)) * 111_320
        ky = 110_540
        px, py = lon * kx, lat * ky
        best_pos, best_off = 0.0, float("inf")
        for i in range(len(self.points) - 1):
            (la1, lo1), (la2, lo2) = self.points[i], self.points[i + 1]
            ax, ay, bx, by = lo1 * kx, la1 * ky, lo2 * kx, la2 * ky
            dx, dy = bx - ax, by - ay
            seg2 = dx * dx + dy * dy
            t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
            off = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if off < best_off:
                best_off = off
                best_pos = self.cum[i] + t * (self.cum[i + 1] - self.cum[i])
        return best_pos, best_off
