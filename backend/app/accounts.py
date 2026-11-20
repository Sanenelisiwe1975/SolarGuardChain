"""Owner profiles and owner-to-owner transfers.

A profile is tied to a phone number or email. Any panel registered to that
contact belongs to the profile automatically, because both use the same
anonymous owner ID (see chain.owner_hash).

Transfers take two steps so nobody can be handed (or robbed of) a panel
without both sides agreeing:
  1. the current owner offers the panel to another profile;
  2. the new owner accepts, and only then is the registry updated.
A panel reported stolen cannot be offered, and pending offers lapse when it is.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from .chain import normalise_contact, owner_hash
from .db import now
from .service import ServiceError, SolarGuard, normalise_serial

PBKDF2_ROUNDS = 120_000
SESSION_DAYS = 30


def _hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${PBKDF2_ROUNDS}${salt.hex()}${digest.hex()}"


def _check_password(password: str, stored: str) -> bool:
    _, rounds, salt, digest = stored.split("$")
    test = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds))
    return hmac.compare_digest(test.hex(), digest)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _mask(contact: str) -> str:
    """'+27710000042' -> '+27•••••0042', 'thandi@example.com' -> 't•••@example.com'."""
    if "@" in contact:
        name, domain = contact.split("@", 1)
        return f"{name[:1]}•••@{domain}"
    return contact[:3] + "•" * max(len(contact) - 7, 2) + contact[-4:]


class Accounts:
    def __init__(self, sg: SolarGuard):
        self.sg = sg
        self.db = sg.db

    # ---------- profiles and sessions ----------

    def _user(self, u: dict) -> dict:
        return {"id": u["id"], "name": u["name"], "contact": u["contact"], "ownerId": u["owner_hash"][:8] + "…" + u["owner_hash"][-6:]}

    def _session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(32)
        self.db.execute("INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?,?,?)",
                        (_token_hash(token), user_id, now()))
        return token

    def signup(self, name: str, contact: str, password: str) -> dict:
        c = normalise_contact(contact)
        if self.db.one("SELECT 1 FROM users WHERE contact = ?", (c,)):
            raise ServiceError(409, "A profile with this phone number or email already exists. Log in instead.")
        cur = self.db.execute(
            "INSERT INTO users (name, contact, owner_hash, password_hash, created_at) VALUES (?,?,?,?,?)",
            (name.strip(), c, owner_hash(c), _hash_password(password), now()),
        )
        u = self.db.one("SELECT * FROM users WHERE id = ?", (cur.lastrowid,))
        return {"token": self._session(u["id"]), "user": self._user(u)}

    def login(self, contact: str, password: str) -> dict:
        u = self.db.one("SELECT * FROM users WHERE contact = ?", (normalise_contact(contact),))
        if not u or not _check_password(password, u["password_hash"]):
            raise ServiceError(401, "Wrong phone number, email or password")
        return {"token": self._session(u["id"]), "user": self._user(u)}

    def logout(self, token: str) -> None:
        self.db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))

    def user_for_token(self, token: str) -> dict:
        if not token:
            raise ServiceError(401, "Log in to see your panels")
        row = self.db.one(
            "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.created_at > ?",
            (_token_hash(token), now() - SESSION_DAYS * 86400),
        )
        if not row:
            raise ServiceError(401, "Your session has expired. Log in again.")
        return row

    # ---------- my panels and transfer offers ----------

    def _offer(self, r: dict) -> dict:
        panel = self.db.one("SELECT model, status FROM panels WHERE serial = ?", (r["serial"],)) or {}
        names = {u["id"]: u for u in self.db.all(
            "SELECT id, name, contact FROM users WHERE id IN (?, ?)", (r["from_user_id"], r["to_user_id"]))}
        sender, recipient = names.get(r["from_user_id"], {}), names.get(r["to_user_id"], {})
        return {
            "id": r["id"],
            "serial": r["serial"],
            "model": panel.get("model", ""),
            "fromName": sender.get("name"),
            "toName": recipient.get("name"),
            "toContact": _mask(recipient.get("contact", "")),
            "status": r["status"],
            "createdAt": r["created_at"],
            "resolvedAt": r["resolved_at"],
        }

    def me(self, user: dict) -> dict:
        panels = self.db.all("SELECT * FROM panels WHERE owner_hash = ? ORDER BY registered_at DESC", (user["owner_hash"],))
        incoming = self.db.all(
            "SELECT * FROM transfer_requests WHERE to_user_id = ? AND status = 'pending' ORDER BY created_at DESC",
            (user["id"],))
        outgoing = self.db.all(
            "SELECT * FROM transfer_requests WHERE from_user_id = ? AND status = 'pending' ORDER BY created_at DESC",
            (user["id"],))
        return {
            "user": self._user(user),
            "panels": [self.sg._panel(p) for p in panels],
            "incoming": [self._offer(r) for r in incoming],
            "outgoing": [self._offer(r) for r in outgoing],
        }

    def offer_transfer(self, user: dict, serial: str, to_contact: str) -> dict:
        s = normalise_serial(serial)
        p = self.sg._get(s)
        if p["owner_hash"] != user["owner_hash"]:
            raise ServiceError(403, f"You are not the registered owner of {s}")
        if p["status"] == "stolen":
            raise ServiceError(409, "A panel reported stolen cannot change owner")
        recipient = self.db.one("SELECT * FROM users WHERE contact = ?", (normalise_contact(to_contact),))
        if not recipient:
            raise ServiceError(404, "No SolarGuard profile uses that phone number or email. "
                                    "Ask the new owner to create a profile first.")
        if recipient["id"] == user["id"]:
            raise ServiceError(409, "You already own this panel")
        if self.db.one("SELECT 1 FROM transfer_requests WHERE serial = ? AND status = 'pending'", (s,)):
            raise ServiceError(409, f"{s} already has a transfer waiting. Cancel it first.")
        self.db.execute(
            "INSERT INTO transfer_requests (serial, from_user_id, to_user_id, created_at) VALUES (?,?,?,?)",
            (s, user["id"], recipient["id"], now()),
        )
        self.sg.bus.publish("transfers", {"serial": s})
        return self.me(user)

    def _pending(self, request_id: int) -> dict:
        r = self.db.one("SELECT * FROM transfer_requests WHERE id = ?", (request_id,))
        if not r:
            raise ServiceError(404, "Transfer not found")
        if r["status"] != "pending":
            raise ServiceError(409, f"This transfer was already {r['status']}")
        return r

    def _close(self, request_id: int, status: str) -> None:
        self.db.execute("UPDATE transfer_requests SET status = ?, resolved_at = ? WHERE id = ?",
                        (status, now(), request_id))

    async def accept(self, user: dict, request_id: int) -> dict:
        r = self._pending(request_id)
        if r["to_user_id"] != user["id"]:
            raise ServiceError(403, "This transfer is not addressed to you")
        sender = self.db.one("SELECT * FROM users WHERE id = ?", (r["from_user_id"],))
        p = self.sg._get(r["serial"])
        # Re-check at acceptance: the panel may have been sold or stolen since the offer.
        if not sender or p["owner_hash"] != sender["owner_hash"] or p["status"] == "stolen":
            self._close(request_id, "cancelled")
            raise ServiceError(409, "This offer is no longer valid: the panel changed owner or was reported stolen")
        await self.sg.transfer(r["serial"], user["name"], user["contact"], actor="Owner (accepted in app)")
        self._close(request_id, "accepted")
        self.sg.bus.publish("transfers", {"serial": r["serial"]})
        return self.me(user)

    def decline(self, user: dict, request_id: int) -> dict:
        r = self._pending(request_id)
        if r["to_user_id"] != user["id"]:
            raise ServiceError(403, "This transfer is not addressed to you")
        self._close(request_id, "declined")
        self.sg.bus.publish("transfers", {"serial": r["serial"]})
        return self.me(user)

    def cancel(self, user: dict, request_id: int) -> dict:
        r = self._pending(request_id)
        if r["from_user_id"] != user["id"]:
            raise ServiceError(403, "Only the owner who sent this transfer can cancel it")
        self._close(request_id, "cancelled")
        self.sg.bus.publish("transfers", {"serial": r["serial"]})
        return self.me(user)
