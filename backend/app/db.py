"""SQLite storage. Personal data (owner name, contact) lives here only, never on-chain."""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS panels (
    serial TEXT PRIMARY KEY,
    owner_name TEXT NOT NULL,
    owner_contact TEXT NOT NULL,
    owner_hash TEXT NOT NULL,
    installer TEXT NOT NULL,
    area TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'clean',          -- clean | stolen
    monitored INTEGER NOT NULL DEFAULT 1,
    sensor_state TEXT NOT NULL DEFAULT 'no_sensor', -- no_sensor | normal | wind | theft | offline_outage | signal_lost
    tilt REAL,
    rms REAL,
    last_seen REAL,
    registered_at REAL NOT NULL,
    updated_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS ownership_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial TEXT NOT NULL,
    kind TEXT NOT NULL,             -- registered | transferred | reported_stolen | recovered
    detail TEXT NOT NULL DEFAULT '',
    from_hash TEXT,
    to_hash TEXT,
    tx_hash TEXT NOT NULL,
    actor TEXT NOT NULL,
    ts REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial TEXT NOT NULL,
    kind TEXT NOT NULL,             -- movement | signal_lost
    severity TEXT NOT NULL,         -- high | medium | low
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',  -- open | confirmed | dismissed
    created_at REAL NOT NULL,
    resolved_at REAL
);

CREATE TABLE IF NOT EXISTS outages (
    area TEXT PRIMARY KEY,
    active INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    contact TEXT NOT NULL UNIQUE,   -- normalised phone or email
    owner_hash TEXT NOT NULL,       -- same anonymous ID the registry uses
    password_hash TEXT NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS transfer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial TEXT NOT NULL,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | cancelled
    created_at REAL NOT NULL,
    resolved_at REAL
);

CREATE TABLE IF NOT EXISTS ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    serial TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE,
    ts REAL NOT NULL
);
"""


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.executescript(SCHEMA)
            self._conn.commit()

    def execute(self, sql: str, params: tuple | dict = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    def one(self, sql: str, params: tuple | dict = ()) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(sql, params).fetchone()
            return dict(row) if row else None

    def all(self, sql: str, params: tuple | dict = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def reset(self) -> None:
        with self._lock:
            for table in ("panels", "ownership_events", "alerts", "outages", "ledger",
                          "users", "sessions", "transfer_requests"):
                self._conn.execute(f"DELETE FROM {table}")
            self._conn.execute("DELETE FROM sqlite_sequence")
            self._conn.commit()


def now() -> float:
    return time.time()
