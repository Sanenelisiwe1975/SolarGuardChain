"""Demo data, and rebuilding the app's tables from the chain after a restart.

Every name and number here is made up."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .chain import owner_hash
from .db import now
from .service import SolarGuard

if TYPE_CHECKING:
    from .accounts import Accounts

log = logging.getLogger("solarguard.seed")

DAY = 86400.0
DEMO_PASSWORD = "solarguard"
INSTALLER = "Sunbelt Installers (demo)"

# Fictional people. Only the ones in DEMO_PROFILES get a login.
PEOPLE = {
    "Thandi Mokoena": "+27 71 000 0042",
    "Pieter van Wyk": "+27 82 000 0107",
    "Sipho Khumalo": "+27 83 000 0107",
    "Lerato Dlamini": "+27 72 000 0666",
    "Ayanda Nkosi": "+27 74 000 0200",
}
DEMO_PROFILES = ("Thandi Mokoena", "Sipho Khumalo", "Ayanda Nkosi")

# serial -> (area, model)
PANELS = {
    "SG-0042": ("Soweto", "JA Solar 550W"),
    "SG-0043": ("Soweto", "JA Solar 550W"),
    "SG-0107": ("Midrand", "Canadian Solar 455W"),
    "SG-0666": ("Kempton Park", "Longi 540W"),
}


def _demo_profiles(accounts: Accounts | None) -> None:
    # Thandi owns SG-0042 and SG-0043; Ayanda owns nothing yet and is the buyer in the transfer demo.
    if accounts:
        for name in DEMO_PROFILES:
            accounts.signup(name, PEOPLE[name], DEMO_PASSWORD)


async def seed(sg: SolarGuard, accounts: Accounts | None = None) -> None:
    sg.db.reset()
    t = now()

    def reg(serial: str, owner: str, ts: float):
        area, model = PANELS[serial]
        return sg.register(serial, owner, PEOPLE[owner], INSTALLER, area, model, ts=ts)

    # The live demo panel and its neighbour: monitored, clean
    await reg("SG-0042", "Thandi Mokoena", t - 40 * DAY)
    await reg("SG-0043", "Thandi Mokoena", t - 40 * DAY + 60)

    # A panel with a resale history: installer -> first owner -> second owner
    await reg("SG-0107", "Pieter van Wyk", t - 400 * DAY)
    await sg.transfer("SG-0107", "Sipho Khumalo", PEOPLE["Sipho Khumalo"], actor="Owner", ts=t - 30 * DAY)

    # A panel already reported stolen, for the buyer-check demo
    await reg("SG-0666", "Lerato Dlamini", t - 200 * DAY)
    await sg.report_stolen("SG-0666", "CAS 214/11/2026 (fictional)", actor="SAPS (demo)", ts=t - 5 * DAY)

    _demo_profiles(accounts)


async def restore_from_chain(sg: SolarGuard, accounts: Accounts | None, events: list[dict]) -> int:
    """Rebuild panels and their history from registry events, without sending
    any transactions. Used when a host starts with an empty disk (e.g. Render's
    free plan): the chain is the source of truth, the database is a cache.

    Names, phone numbers and areas never go on-chain, so they come back only
    for the fictional demo people; other owners show as private until they log
    in again with the contact their panel was registered to."""
    sg.db.reset()
    known = {owner_hash(contact): (name, contact) for name, contact in PEOPLE.items()}

    def owner(h: str) -> tuple[str, str]:
        return known.get(h, ("Private owner", ""))

    for e in events:
        s, ts, tx = e["serial"], e["ts"], e["txHash"]
        if e["action"] == "registerPanel":
            if sg.db.one("SELECT 1 FROM panels WHERE serial = ?", (s,)):
                continue
            name, contact = owner(e["ownerHash"])
            area, model = PANELS.get(s, ("Unknown area", ""))
            installer = INSTALLER if s in PANELS else f"Registrar {e['registrar'][:8]}…"
            sg.db.execute(
                "INSERT INTO panels (serial, owner_name, owner_contact, owner_hash, installer, area, model, "
                "registered_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
                (s, name, contact, e["ownerHash"], installer, area, model, ts, ts),
            )
            sg._record(s, "registered", tx, installer, f"Registered by {installer}", to_hash=e["ownerHash"], ts=ts)
        elif not sg.db.one("SELECT 1 FROM panels WHERE serial = ?", (s,)):
            log.warning("Skipping %s for %s: panel was never registered", e["action"], s)
        elif e["action"] == "transferOwnership":
            name, contact = owner(e["ownerHash"])
            sg.db.execute(
                "UPDATE panels SET owner_name = ?, owner_contact = ?, owner_hash = ?, updated_at = ? WHERE serial = ?",
                (name, contact, e["ownerHash"], ts, s),
            )
            sg._record(s, "transferred", tx, "Owner", "Ownership transferred",
                       from_hash=e["fromOwner"], to_hash=e["ownerHash"], ts=ts)
        elif e["action"] == "reportStolen":
            sg.db.execute("UPDATE panels SET status = 'stolen', updated_at = ? WHERE serial = ?", (ts, s))
            sg._record(s, "reported_stolen", tx, "Owner", e["caseRef"], ts=ts)
        elif e["action"] == "markRecovered":
            sg.db.execute("UPDATE panels SET status = 'clean', updated_at = ? WHERE serial = ?", (ts, s))
            sg._record(s, "recovered", tx, "Owner", "Panel recovered", ts=ts)

    _demo_profiles(accounts)
    count = sg.db.one("SELECT COUNT(*) AS n FROM panels")["n"]
    log.info("Restored %d panels from %d registry events", count, len(events))
    return count
