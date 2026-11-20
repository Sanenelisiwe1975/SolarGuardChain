"""Business logic. Routes stay thin; everything testable lives here."""

from __future__ import annotations

import logging
import re

from .chain import RegistryClient, owner_hash
from .config import settings
from .db import Database, now
from .events import Broadcaster
from .intelligence import classify, context_check, draft_alert
from .notify import send_whatsapp

log = logging.getLogger("solarguard.service")

SERIAL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9\-_/.]{2,63}$")
SENSOR_STATES = {"normal", "wind", "theft"}


class ServiceError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def normalise_serial(serial: str) -> str:
    s = serial.strip().upper()
    if not SERIAL_RE.match(s):
        raise ServiceError(422, "Serial must be 3–64 letters, digits or - _ / .")
    return s


def _short(h: str | None) -> str | None:
    return f"{h[:8]}…{h[-6:]}" if h else None


class SolarGuard:
    def __init__(self, db: Database, registry: RegistryClient, bus: Broadcaster):
        self.db = db
        self.registry = registry
        self.bus = bus

    # ---------- serialisers ----------

    def _explorer(self, tx_hash: str) -> str | None:
        return f"{settings.explorer_base}/tx/{tx_hash}" if self.registry.mode == "fuji" else None

    def _event(self, e: dict) -> dict:
        return {
            "id": e["id"],
            "kind": e["kind"],
            "detail": e["detail"],
            "fromOwner": _short(e["from_hash"]),
            "toOwner": _short(e["to_hash"]),
            "txHash": e["tx_hash"],
            "explorerUrl": self._explorer(e["tx_hash"]),
            "actor": e["actor"],
            "ts": e["ts"],
        }

    def _history(self, serial: str) -> list[dict]:
        rows = self.db.all("SELECT * FROM ownership_events WHERE serial = ? ORDER BY ts DESC, id DESC", (serial,))
        return [self._event(r) for r in rows]

    def _panel(self, p: dict, with_history: bool = False) -> dict:
        out = {
            "serial": p["serial"],
            "ownerName": p["owner_name"],
            "ownerContact": p["owner_contact"],
            "ownerHash": _short(p["owner_hash"]),
            "installer": p["installer"],
            "area": p["area"],
            "model": p["model"],
            "status": p["status"],
            "monitored": bool(p["monitored"]),
            "sensorState": p["sensor_state"],
            "tilt": p["tilt"],
            "rms": p["rms"],
            "lastSeen": p["last_seen"],
            "registeredAt": p["registered_at"],
            "updatedAt": p["updated_at"],
            "openAlerts": self.db.one(
                "SELECT COUNT(*) AS n FROM alerts WHERE serial = ? AND status = 'open'", (p["serial"],)
            )["n"],
        }
        if with_history:
            out["history"] = self._history(p["serial"])
        return out

    def _alert(self, a: dict) -> dict:
        panel = self.db.one("SELECT owner_name, area, status FROM panels WHERE serial = ?", (a["serial"],)) or {}
        return {
            "id": a["id"],
            "serial": a["serial"],
            "kind": a["kind"],
            "severity": a["severity"],
            "title": a["title"],
            "message": a["message"],
            "context": a["context"],
            "status": a["status"],
            "createdAt": a["created_at"],
            "resolvedAt": a["resolved_at"],
            "area": panel.get("area"),
            "ownerName": panel.get("owner_name"),
            "panelStatus": panel.get("status"),
        }

    def _get(self, serial: str) -> dict:
        p = self.db.one("SELECT * FROM panels WHERE serial = ?", (serial,))
        if not p:
            raise ServiceError(404, f"Panel {serial} is not registered")
        return p

    def _record(self, serial: str, kind: str, tx_hash: str, actor: str, detail: str = "",
                from_hash: str | None = None, to_hash: str | None = None, ts: float | None = None) -> None:
        self.db.execute(
            "INSERT INTO ownership_events (serial, kind, detail, from_hash, to_hash, tx_hash, actor, ts) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (serial, kind, detail, from_hash, to_hash, tx_hash, actor, ts or now()),
        )

    def _cancel_pending_transfers(self, serial: str) -> None:
        """Owner-to-owner transfer offers lapse once the panel changes hands or is stolen."""
        cur = self.db.execute(
            "UPDATE transfer_requests SET status = 'cancelled', resolved_at = ? WHERE serial = ? AND status = 'pending'",
            (now(), serial),
        )
        if cur.rowcount:
            self.bus.publish("transfers", {"serial": serial})

    # ---------- queries ----------

    def list_panels(self) -> list[dict]:
        return [self._panel(p) for p in self.db.all("SELECT * FROM panels ORDER BY registered_at DESC")]

    def get_panel(self, serial: str) -> dict:
        return self._panel(self._get(normalise_serial(serial)), with_history=True)

    async def lookup(self, serial: str) -> dict:
        """Public check for buyers. No personal data leaves this function.

        The verdict comes from the registry itself (the contract on Fuji, the
        hash-chained ledger locally), not from the app's own tables. The app
        database only adds descriptive details such as the model."""
        s = normalise_serial(serial)
        p = self.db.one("SELECT * FROM panels WHERE serial = ?", (s,))
        try:
            rec = await self.registry.status(s)
            verified = True
        except Exception as exc:  # registry unreachable: say so rather than fail
            log.warning("Registry read failed for %s: %s", s, exc)
            rec, verified = None, False

        if rec:
            result, owner, transfers = rec.status, rec.owner_hash, rec.transfers
        elif p:
            result, owner = p["status"], p["owner_hash"]
            transfers = sum(1 for e in self._history(s) if e["kind"] == "transferred")
        else:
            result, owner, transfers = "unregistered", None, 0

        base = {"serial": s, "result": result, "registry": self.registry.label, "verifiedOnRegistry": verified}
        if result == "unregistered":
            return {**base, "history": []}
        return {
            **base,
            "installer": p["installer"] if p else None,
            "model": p["model"] if p else "",
            "registeredAt": p["registered_at"] if p else None,
            "transfers": transfers,
            "currentOwner": _short(owner),
            "history": self._history(s) if p else [],  # owner hashes only, never names or contacts
            # The app's copy should always agree with the registry; if not, the registry wins.
            "matchesRegistry": bool(p) and rec is not None and p["status"] == rec.status and p["owner_hash"] == rec.owner_hash,
        }

    def list_alerts(self, status: str | None = None) -> list[dict]:
        if status:
            rows = self.db.all("SELECT * FROM alerts WHERE status = ? ORDER BY created_at DESC", (status,))
        else:
            rows = self.db.all("SELECT * FROM alerts ORDER BY created_at DESC LIMIT 100")
        return [self._alert(a) for a in rows]

    def stats(self) -> dict:
        q = lambda sql: self.db.one(sql)["n"]  # noqa: E731
        return {
            "panels": q("SELECT COUNT(*) AS n FROM panels"),
            "monitored": q("SELECT COUNT(*) AS n FROM panels WHERE monitored = 1 AND sensor_state != 'no_sensor'"),
            "stolen": q("SELECT COUNT(*) AS n FROM panels WHERE status = 'stolen'"),
            "openAlerts": q("SELECT COUNT(*) AS n FROM alerts WHERE status = 'open'"),
            "registry": self.registry.info(),
        }

    def outages(self) -> list[dict]:
        areas = [r["area"] for r in self.db.all("SELECT DISTINCT area FROM panels ORDER BY area")]
        active = {r["area"] for r in self.db.all("SELECT area FROM outages WHERE active = 1")}
        return [{"area": a, "active": a in active} for a in areas]

    # ---------- registry commands ----------

    async def register(self, serial: str, owner_name: str, owner_contact: str, installer: str,
                       area: str, model: str = "", ts: float | None = None) -> dict:
        s = normalise_serial(serial)
        if self.db.one("SELECT 1 FROM panels WHERE serial = ?", (s,)):
            raise ServiceError(409, f"Panel {s} is already registered")
        oh = owner_hash(owner_contact)
        tx = await self.registry.register(s, oh)
        t = ts or now()
        self.db.execute(
            "INSERT INTO panels (serial, owner_name, owner_contact, owner_hash, installer, area, model, "
            "registered_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (s, owner_name.strip(), owner_contact.strip(), oh, installer.strip(), area.strip(), model.strip(), t, t),
        )
        self._record(s, "registered", tx.tx_hash, installer.strip(), f"Registered by {installer.strip()}",
                     to_hash=oh, ts=t)
        self.bus.publish("panels", {"serial": s})
        return self.get_panel(s)

    async def transfer(self, serial: str, new_owner_name: str, new_owner_contact: str,
                       actor: str = "Owner", ts: float | None = None) -> dict:
        s = normalise_serial(serial)
        p = self._get(s)
        if p["status"] == "stolen":
            raise ServiceError(409, "A panel reported stolen cannot change owner")
        new_hash = owner_hash(new_owner_contact)
        if new_hash == p["owner_hash"]:
            raise ServiceError(409, "New owner is the same as the current owner")
        tx = await self.registry.transfer(s, new_hash)
        t = ts or now()
        self.db.execute(
            "UPDATE panels SET owner_name = ?, owner_contact = ?, owner_hash = ?, updated_at = ? WHERE serial = ?",
            (new_owner_name.strip(), new_owner_contact.strip(), new_hash, t, s),
        )
        self._record(s, "transferred", tx.tx_hash, actor, "Ownership transferred",
                     from_hash=p["owner_hash"], to_hash=new_hash, ts=t)
        self._cancel_pending_transfers(s)
        self.bus.publish("panels", {"serial": s})
        return self.get_panel(s)

    async def report_stolen(self, serial: str, case_ref: str = "", actor: str = "Owner",
                            ts: float | None = None) -> dict:
        s = normalise_serial(serial)
        p = self._get(s)
        if p["status"] == "stolen":
            raise ServiceError(409, f"Panel {s} is already reported stolen")
        ref = case_ref.strip() or "Reported by owner"
        tx = await self.registry.report_stolen(s, ref)
        t = ts or now()
        self.db.execute("UPDATE panels SET status = 'stolen', updated_at = ? WHERE serial = ?", (t, s))
        self._record(s, "reported_stolen", tx.tx_hash, actor, ref, ts=t)
        self._cancel_pending_transfers(s)
        self.bus.publish("panels", {"serial": s})
        return self.get_panel(s)

    async def recover(self, serial: str, actor: str = "Owner") -> dict:
        s = normalise_serial(serial)
        p = self._get(s)
        if p["status"] != "stolen":
            raise ServiceError(409, f"Panel {s} is not reported stolen")
        tx = await self.registry.recover(s)
        t = now()
        self.db.execute("UPDATE panels SET status = 'clean', updated_at = ? WHERE serial = ?", (t, s))
        self._record(s, "recovered", tx.tx_hash, actor, "Panel recovered", ts=t)
        self.bus.publish("panels", {"serial": s})
        return self.get_panel(s)

    # ---------- alerts ----------

    async def _raise_alert(self, panel: dict, kind: str, severity: str, ctx_summary: str = "") -> dict | None:
        existing = self.db.one(
            "SELECT id FROM alerts WHERE serial = ? AND kind = ? AND status = 'open'", (panel["serial"], kind)
        )
        if existing:
            return None
        title, message = await draft_alert(kind, panel, None)
        cur = self.db.execute(
            "INSERT INTO alerts (serial, kind, severity, title, message, context, created_at) VALUES (?,?,?,?,?,?,?)",
            (panel["serial"], kind, severity, title, message, ctx_summary, now()),
        )
        alert = self._alert(self.db.one("SELECT * FROM alerts WHERE id = ?", (cur.lastrowid,)))
        self.bus.publish("alerts", {"id": alert["id"], "serial": panel["serial"], "title": title})
        await send_whatsapp(f"⚠️ SolarGuard: {title}\n{message}")
        return alert

    async def confirm_alert(self, alert_id: int, case_ref: str = "") -> dict:
        a = self.db.one("SELECT * FROM alerts WHERE id = ?", (alert_id,))
        if not a:
            raise ServiceError(404, "Alert not found")
        if a["status"] != "open":
            raise ServiceError(409, "Alert is already resolved")
        p = self._get(a["serial"])
        if p["status"] != "stolen":
            await self.report_stolen(a["serial"], case_ref or f"SolarGuard alert #{alert_id}", actor="Owner")
        self.db.execute("UPDATE alerts SET status = 'confirmed', resolved_at = ? WHERE id = ?", (now(), alert_id))
        self.bus.publish("alerts", {"id": alert_id})
        return self._alert(self.db.one("SELECT * FROM alerts WHERE id = ?", (alert_id,)))

    def dismiss_alert(self, alert_id: int) -> dict:
        a = self.db.one("SELECT * FROM alerts WHERE id = ?", (alert_id,))
        if not a:
            raise ServiceError(404, "Alert not found")
        if a["status"] != "open":
            raise ServiceError(409, "Alert is already resolved")
        self.db.execute("UPDATE alerts SET status = 'dismissed', resolved_at = ? WHERE id = ?", (now(), alert_id))
        self.bus.publish("alerts", {"id": alert_id})
        return self._alert(self.db.one("SELECT * FROM alerts WHERE id = ?", (alert_id,)))

    # ---------- sensor ----------

    async def sensor_event(self, serial: str, kind: str, state: str | None,
                           tilt: float | None, rms: float | None) -> dict:
        s = normalise_serial(serial)
        p = self._get(s)
        t = now()

        if kind == "heartbeat":
            new_state = state if state in SENSOR_STATES else "normal"
            # A heartbeat cannot clear a theft state on its own: the owner resolves that.
            if p["sensor_state"] == "theft" and new_state != "theft":
                new_state = "theft" if self.db.one(
                    "SELECT 1 FROM alerts WHERE serial = ? AND kind = 'movement' AND status = 'open'", (s,)
                ) else new_state
            self.db.execute("UPDATE panels SET last_seen = ?, sensor_state = ? WHERE serial = ?", (t, new_state, s))
            if new_state != p["sensor_state"]:
                self.bus.publish("panels", {"serial": s})
            return {"serial": s, "state": new_state, "alert": None}

        # state_change: the server re-classifies from the raw features
        label = classify(tilt, rms)
        if state == "theft" and label != "theft":
            log.info("Client said theft but features say %s for %s", label, s)
        self.db.execute(
            "UPDATE panels SET last_seen = ?, sensor_state = ?, tilt = ?, rms = ? WHERE serial = ?",
            (t, label, tilt, rms, s),
        )
        alert = None
        if label == "theft":
            panel = self._get(s)
            alert = await self._raise_alert(panel, "movement", "high", "the movement was a lift or tilt, not wind.")
        self.bus.publish("panels", {"serial": s})
        return {"serial": s, "state": label, "alert": alert}

    async def watchdog_tick(self) -> list[dict]:
        """Turn silent sensors into either 'offline (outage)' or a signal-lost alert."""
        raised = []
        cutoff = now() - settings.heartbeat_timeout_s
        rows = self.db.all(
            "SELECT * FROM panels WHERE monitored = 1 AND last_seen IS NOT NULL AND last_seen < ? "
            "AND sensor_state IN ('normal','wind','theft','offline_outage')",
            (cutoff,),
        )
        for p in rows:
            ctx = context_check(self.db, p["area"])
            if ctx.outage:
                if p["sensor_state"] != "offline_outage":
                    self.db.execute("UPDATE panels SET sensor_state = 'offline_outage' WHERE serial = ?", (p["serial"],))
                    self.bus.publish("panels", {"serial": p["serial"]})
                continue
            self.db.execute("UPDATE panels SET sensor_state = 'signal_lost' WHERE serial = ?", (p["serial"],))
            alert = await self._raise_alert(p, "signal_lost", "high", ctx.summary)
            self.bus.publish("panels", {"serial": p["serial"]})
            if alert:
                raised.append(alert)
        return raised

    # ---------- demo controls ----------

    def set_outage(self, area: str, active: bool) -> list[dict]:
        self.db.execute(
            "INSERT INTO outages (area, active) VALUES (?, ?) ON CONFLICT(area) DO UPDATE SET active = excluded.active",
            (area, int(active)),
        )
        self.bus.publish("outages", {"area": area, "active": active})
        return self.outages()
