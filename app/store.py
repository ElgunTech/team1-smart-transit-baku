"""SQLite persistence for live data: buses, GPS pings, crowd reports, alerts."""
import sqlite3
import threading
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS buses (
    id          TEXT PRIMARY KEY,
    route_id    TEXT NOT NULL,
    plate       TEXT NOT NULL,
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    pos_m       REAL NOT NULL,
    direction   INTEGER NOT NULL,
    speed_kmh   REAL NOT NULL,
    updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS gps_pings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    bus_id      TEXT NOT NULL,
    lat         REAL NOT NULL,
    lon         REAL NOT NULL,
    speed_kmh   REAL,
    ts          REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id    TEXT NOT NULL,
    bus_id      TEXT,
    stop_id     TEXT,
    level       TEXT NOT NULL CHECK (level IN ('low', 'medium', 'high')),
    client_id   TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'user',
    ts          REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_reports_route_ts ON reports (route_id, ts);
CREATE INDEX IF NOT EXISTS ix_reports_client ON reports (client_id, route_id, ts);
CREATE TABLE IF NOT EXISTS alerts (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    route_id            TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'open',
    created_at          REAL NOT NULL,
    updated_at          REAL NOT NULL,
    closed_at           REAL,
    high_reports        INTEGER NOT NULL,
    total_reports       INTEGER NOT NULL,
    high_share          REAL NOT NULL,
    recommended_buses   INTEGER NOT NULL,
    donor_route_id      TEXT,
    message             TEXT NOT NULL,
    resolution          TEXT
);
CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL CHECK (role IN ('passenger', 'operator')),
    created_at      REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users (id),
    expires_at  REAL NOT NULL
);
"""


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.executescript(SCHEMA)
            # migrate older databases: verification fields on reports
            cols = {r[1] for r in self._conn.execute("PRAGMA table_info(reports)")}
            for col, ddl in (("verified", "INTEGER NOT NULL DEFAULT 0"), ("verified_by", "TEXT"),
                             ("lat", "REAL"), ("lon", "REAL")):
                if col not in cols:
                    self._conn.execute(f"ALTER TABLE reports ADD COLUMN {col} {ddl}")
            self._conn.commit()

    def _query(self, sql: str, params: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def _one(self, sql: str, params: tuple = ()) -> dict | None:
        rows = self._query(sql, params)
        return rows[0] if rows else None

    def _exec(self, sql: str, params: tuple = ()) -> int:
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur.lastrowid

    # --- buses -------------------------------------------------------------
    def count_buses(self, route_id: str | None = None) -> int:
        if route_id:
            return self._one("SELECT COUNT(*) n FROM buses WHERE route_id = ?", (route_id,))["n"]
        return self._one("SELECT COUNT(*) n FROM buses")["n"]

    def bus_counts(self) -> dict[str, int]:
        rows = self._query("SELECT route_id, COUNT(*) n FROM buses GROUP BY route_id")
        return {r["route_id"]: r["n"] for r in rows}

    def get_bus(self, bus_id: str) -> dict | None:
        return self._one("SELECT * FROM buses WHERE id = ?", (bus_id,))

    def list_buses(self, route_id: str | None = None) -> list[dict]:
        if route_id:
            return self._query("SELECT * FROM buses WHERE route_id = ? ORDER BY id", (route_id,))
        return self._query("SELECT * FROM buses ORDER BY route_id, id")

    def upsert_bus(self, bus: dict) -> None:
        self._exec(
            """INSERT INTO buses (id, route_id, plate, lat, lon, pos_m, direction, speed_kmh, updated_at)
               VALUES (:id, :route_id, :plate, :lat, :lon, :pos_m, :direction, :speed_kmh, :updated_at)
               ON CONFLICT(id) DO UPDATE SET route_id = excluded.route_id, plate = excluded.plate,
                 lat = excluded.lat, lon = excluded.lon, pos_m = excluded.pos_m,
                 direction = excluded.direction, speed_kmh = excluded.speed_kmh,
                 updated_at = excluded.updated_at""",
            bus,
        )

    def update_positions(self, rows: list[tuple]) -> None:
        """Bulk position update in one transaction: (lat, lon, pos_m, direction, speed_kmh, updated_at, id)."""
        with self._lock:
            self._conn.executemany(
                """UPDATE buses SET lat = ?, lon = ?, pos_m = ?, direction = ?, speed_kmh = ?, updated_at = ?
                   WHERE id = ?""", rows)
            self._conn.commit()

    def insert_buses(self, buses: list[dict]) -> None:
        with self._lock:
            self._conn.executemany(
                """INSERT INTO buses (id, route_id, plate, lat, lon, pos_m, direction, speed_kmh, updated_at)
                   VALUES (:id, :route_id, :plate, :lat, :lon, :pos_m, :direction, :speed_kmh, :updated_at)""",
                buses)
            self._conn.commit()

    def add_ping(self, bus_id: str, lat: float, lon: float, speed_kmh: float | None, ts: float) -> None:
        self._exec("INSERT INTO gps_pings (bus_id, lat, lon, speed_kmh, ts) VALUES (?, ?, ?, ?, ?)",
                   (bus_id, lat, lon, speed_kmh, ts))

    def prune_pings(self, older_than: float) -> None:
        self._exec("DELETE FROM gps_pings WHERE ts < ?", (older_than,))

    # --- reports -------------------------------------------------------------
    def add_report(self, route_id: str, level: str, client_id: str, ts: float,
                   bus_id: str | None = None, stop_id: str | None = None, source: str = "user") -> int:
        return self._exec(
            """INSERT INTO reports (route_id, bus_id, stop_id, level, client_id, source, ts)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (route_id, bus_id, stop_id, level, client_id, source, ts),
        )

    def count_reports_since(self, client_id: str, since: float) -> int:
        return self._one("SELECT COUNT(*) n FROM reports WHERE client_id = ? AND ts >= ?", (client_id, since))["n"]

    def set_report_location(self, report_id: int, lat: float, lon: float) -> None:
        self._exec("UPDATE reports SET lat = ?, lon = ? WHERE id = ?", (lat, lon, report_id))

    def verify_reports(self, report_ids: list[int], how: str) -> None:
        if not report_ids:
            return
        marks = ",".join("?" * len(report_ids))
        self._exec(f"UPDATE reports SET verified = 1, verified_by = ? WHERE verified = 0 AND id IN ({marks})",
                   (how, *report_ids))

    def corroborating_reports(self, route_id: str, level: str, client_id: str, since: float) -> list[dict]:
        """Reports from other passengers on the same line with the same level."""
        return self._query(
            "SELECT * FROM reports WHERE route_id = ? AND level = ? AND client_id != ? AND ts >= ?",
            (route_id, level, client_id, since))

    def report_stats(self, client_id: str) -> dict:
        return self._one(
            """SELECT COUNT(*) total, COALESCE(SUM(verified), 0) verified FROM reports WHERE client_id = ?""",
            (client_id,))

    def get_report(self, report_id: int) -> dict | None:
        return self._one("SELECT * FROM reports WHERE id = ?", (report_id,))

    def last_report_ts(self, client_id: str, route_id: str) -> float | None:
        row = self._one("SELECT MAX(ts) ts FROM reports WHERE client_id = ? AND route_id = ?",
                        (client_id, route_id))
        return row["ts"] if row else None

    def reports_since(self, since: float, route_id: str | None = None,
                      bus_id: str | None = None) -> list[dict]:
        sql, params = "SELECT * FROM reports WHERE ts >= ?", [since]
        if route_id:
            sql += " AND route_id = ?"
            params.append(route_id)
        if bus_id:
            sql += " AND bus_id = ?"
            params.append(bus_id)
        return self._query(sql + " ORDER BY ts", tuple(params))

    def recent_reports(self, limit: int) -> list[dict]:
        return self._query("SELECT * FROM reports ORDER BY ts DESC, id DESC LIMIT ?", (limit,))

    # --- alerts ----------------------------------------------------------------
    def get_alert(self, alert_id: int) -> dict | None:
        return self._one("SELECT * FROM alerts WHERE id = ?", (alert_id,))

    def open_alert(self, route_id: str) -> dict | None:
        return self._one("SELECT * FROM alerts WHERE route_id = ? AND status = 'open'", (route_id,))

    def last_closed_alert(self, route_id: str) -> dict | None:
        return self._one(
            "SELECT * FROM alerts WHERE route_id = ? AND status != 'open' ORDER BY closed_at DESC LIMIT 1",
            (route_id,))

    def list_alerts(self, status: str | None, limit: int) -> list[dict]:
        if status:
            return self._query("SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC LIMIT ?",
                               (status, limit))
        return self._query(
            "SELECT * FROM alerts ORDER BY status = 'open' DESC, created_at DESC LIMIT ?", (limit,))

    def create_alert(self, alert: dict) -> int:
        return self._exec(
            """INSERT INTO alerts (route_id, status, created_at, updated_at, high_reports, total_reports,
                                   high_share, recommended_buses, donor_route_id, message)
               VALUES (:route_id, 'open', :now, :now, :high_reports, :total_reports,
                       :high_share, :recommended_buses, :donor_route_id, :message)""",
            alert,
        )

    def refresh_alert(self, alert_id: int, high: int, total: int, share: float, now: float) -> None:
        self._exec(
            "UPDATE alerts SET high_reports = ?, total_reports = ?, high_share = ?, updated_at = ? WHERE id = ?",
            (high, total, share, now, alert_id))

    def close_alert(self, alert_id: int, status: str, resolution: str, now: float) -> None:
        self._exec(
            "UPDATE alerts SET status = ?, resolution = ?, closed_at = ?, updated_at = ? WHERE id = ?",
            (status, resolution, now, now, alert_id))

    # --- users & sessions ---------------------------------------------------------
    def get_user_by_email(self, email: str) -> dict | None:
        return self._one("SELECT * FROM users WHERE email = ?", (email,))

    def create_user(self, name: str, email: str, password_hash: str, role: str, now: float) -> int:
        return self._exec(
            "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
            (name, email, password_hash, role, now))

    def create_session(self, token: str, user_id: int, expires_at: float) -> None:
        self._exec("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
                   (token, user_id, expires_at))

    def user_for_token(self, token: str, now: float) -> dict | None:
        return self._one(
            """SELECT u.id, u.name, u.email, u.role FROM sessions s JOIN users u ON u.id = s.user_id
               WHERE s.token = ? AND s.expires_at > ?""", (token, now))

    def delete_session(self, token: str) -> None:
        self._exec("DELETE FROM sessions WHERE token = ?", (token,))
