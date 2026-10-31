"""Analytics engine: pure functions with no I/O, so they are easy to test.

- congestion level of a line from crowdsourced reports (sliding window, recency-weighted)
- anomaly rule that triggers a reserve-bus recommendation
- ETA of a bus to a stop along the route
"""
from dataclasses import dataclass

from . import config

LEVELS = ("low", "medium", "high")
LEVEL_SCORE = {"low": 1, "medium": 2, "high": 3}


@dataclass
class Congestion:
    level: str  # low | medium | high | unknown
    score: float | None
    total: int
    counts: dict[str, int]
    high_share: float

    def as_dict(self) -> dict:
        return {
            "level": self.level,
            "score": self.score,
            "total_reports": self.total,
            "counts": self.counts,
            "high_share": round(self.high_share, 2),
        }


def compute_congestion(reports: list[tuple[str, float]], now: float,
                       window_sec: int = config.WINDOW_SEC) -> Congestion:
    """reports: (level, timestamp) pairs. Only reports inside the window count;
    newer reports weigh up to 2x more than reports at the edge of the window."""
    counts = {lvl: 0 for lvl in LEVELS}
    weight_sum = score_sum = 0.0
    for level, ts in reports:
        age = now - ts
        if age < 0 or age > window_sec or level not in LEVEL_SCORE:
            continue
        counts[level] += 1
        w = 1.0 - 0.5 * (age / window_sec)
        weight_sum += w
        score_sum += w * LEVEL_SCORE[level]

    total = sum(counts.values())
    if total == 0:
        return Congestion("unknown", None, 0, counts, 0.0)
    score = score_sum / weight_sum
    if score < 5 / 3:
        level = "low"
    elif score < 7 / 3:
        level = "medium"
    else:
        level = "high"
    return Congestion(level, round(score, 2), total, counts, counts["high"] / total)


def is_anomaly(c: Congestion, min_high: int = config.HIGH_MIN_REPORTS,
               share: float = config.HIGH_SHARE) -> bool:
    """High congestion confirmed by several independent passengers in the window."""
    return c.counts["high"] >= min_high and c.high_share >= share


def recommended_reserve(c: Congestion, min_high: int = config.HIGH_MIN_REPORTS) -> int:
    """1 extra bus by default, 2 when the signal is overwhelming."""
    if c.high_share >= 0.8 and c.counts["high"] >= 2 * min_high:
        return 2
    return 1


def pick_donor_route(target_route: str, congestion: dict[str, Congestion],
                     bus_counts: dict[str, int]) -> str | None:
    """A line with confirmed low load and at least 2 buses can lend one.
    This addresses the core problem: empty buses on one line, full stops on another."""
    candidates = [
        rid for rid, c in congestion.items()
        if rid != target_route and c.level == "low" and bus_counts.get(rid, 0) >= 2
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda rid: (congestion[rid].score, -bus_counts[rid]))


def travel_distance(bus_pos: float, direction: int, target_pos: float, length: float,
                    loop: bool = False) -> float:
    """Metres a bus still has to drive to reach target_pos. On a circular line the
    bus always moves forward and wraps around; on a linear line it shuttles between
    terminals, so a bus moving away from the stop reaches it after turning around."""
    if loop:
        return (target_pos - bus_pos) % length
    if direction >= 0:
        if target_pos >= bus_pos:
            return target_pos - bus_pos
        return (length - bus_pos) + (length - target_pos)
    if target_pos <= bus_pos:
        return bus_pos - target_pos
    return bus_pos + target_pos


def eta_seconds(distance_m: float, speed_kmh: float | None, stops_between: int,
                dwell_sec: int = config.DWELL_SEC_PER_STOP) -> int:
    speed = speed_kmh if speed_kmh and speed_kmh >= 3 else config.DEFAULT_SPEED_KMH
    return round(distance_m / (speed / 3.6) + stops_between * dwell_sec)
