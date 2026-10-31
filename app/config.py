"""Runtime settings. Every value can be overridden with an environment variable."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"


def _int(name: str, default: int) -> int:
    return int(os.getenv(name, default))


def _float(name: str, default: float) -> float:
    return float(os.getenv(name, default))


DB_PATH = os.getenv("TRANSIT_DB", str(BASE_DIR / "data" / "transit.db"))

# Anomaly detection: a line is "high" when, inside the sliding window,
# at least HIGH_MIN_REPORTS high reports exist and they make up HIGH_SHARE of all reports.
WINDOW_SEC = _int("WINDOW_MINUTES", 10) * 60
HIGH_MIN_REPORTS = _int("HIGH_MIN_REPORTS", 3)
HIGH_SHARE = _float("HIGH_SHARE", 0.6)

# One passenger (client id) may report the same line once per cooldown.
REPORT_COOLDOWN_SEC = _int("REPORT_COOLDOWN_SEC", 120)

# GPS pings further than this from the route polyline are rejected.
MAX_GPS_OFFSET_M = _float("MAX_GPS_OFFSET_M", 400)

# Passenger phone acting as the bus GPS ("I'm on this bus").
LIVE_TTL_SEC = _int("LIVE_TTL_SEC", 30)            # bus counts as live this long after the last fix
MAX_GPS_ACCURACY_M = _float("MAX_GPS_ACCURACY_M", 200)

DEFAULT_SPEED_KMH = _float("DEFAULT_SPEED_KMH", 18)
DWELL_SEC_PER_STOP = _int("DWELL_SEC_PER_STOP", 25)

SESSION_TTL_SEC = _int("SESSION_TTL_HOURS", 12) * 3600
# Default operator account for the demo; override in production.
OPERATOR_EMAIL = os.getenv("OPERATOR_EMAIL", "operator@smarttransit.az")
OPERATOR_PASSWORD = os.getenv("OPERATOR_PASSWORD", "operator123")

SIMULATE = os.getenv("SIMULATE", "1") == "1"
SIM_TICK_SEC = _float("SIM_TICK_SEC", 2)
