"""Owner profiles, two-step transfers, and the registry-backed buyer check."""

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.seed import DEMO_PASSWORD

THANDI = "+27 71 000 0042"
AYANDA = "+27 74 000 0200"


@pytest.fixture()
def client(tmp_path):
    app = create_app(db_path=str(tmp_path / "test.db"), run_watchdog=False)
    with TestClient(app) as c:
        yield c


def login(client, contact):
    r = client.post("/api/auth/login", json={"contact": contact, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_signup_login_and_panels_follow_contact(client):
    # Registered to a contact before the profile existed: still shows up, in any phone format.
    client.post("/api/panels", json={"serial": "SG-5000", "ownerName": "Nomsa", "ownerContact": "082 555 0000",
                                     "installer": "Demo", "area": "Soweto"})
    r = client.post("/api/auth/signup", json={"name": "Nomsa", "contact": "+27 82 555 0000", "password": "longenough"})
    assert r.status_code == 201
    me = client.get("/api/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).json()
    assert [p["serial"] for p in me["panels"]] == ["SG-5000"]

    dup = client.post("/api/auth/signup", json={"name": "X", "contact": "0825550000", "password": "longenough"})
    assert dup.status_code == 409
    bad = client.post("/api/auth/login", json={"contact": "0825550000", "password": "wrong-password"})
    assert bad.status_code == 401


def test_me_requires_login(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer nonsense"}).status_code == 401


def test_owner_offers_and_buyer_accepts(client):
    thandi, ayanda = login(client, THANDI), login(client, AYANDA)
    assert len(client.get("/api/me", headers=thandi).json()["panels"]) == 2

    r = client.post("/api/me/panels/SG-0042/transfer", json={"toContact": "0740000200"}, headers=thandi)
    assert r.status_code == 200
    assert r.json()["outgoing"][0]["toName"] == "Ayanda Nkosi"

    # Nothing changes on the registry until the buyer accepts.
    assert client.get("/api/panels/SG-0042").json()["ownerName"] == "Thandi Mokoena"
    incoming = client.get("/api/me", headers=ayanda).json()["incoming"]
    assert [o["serial"] for o in incoming] == ["SG-0042"]

    r = client.post(f"/api/me/transfers/{incoming[0]['id']}/accept", headers=ayanda)
    assert r.status_code == 200
    assert [p["serial"] for p in r.json()["panels"]] == ["SG-0042"]
    assert [p["serial"] for p in client.get("/api/me", headers=thandi).json()["panels"]] == ["SG-0043"]
    assert client.get("/api/lookup/SG-0042").json()["transfers"] == 1


def test_only_the_owner_can_offer(client):
    ayanda = login(client, AYANDA)
    r = client.post("/api/me/panels/SG-0042/transfer", json={"toContact": AYANDA}, headers=ayanda)
    assert r.status_code == 403


def test_offer_needs_existing_profile_and_clean_panel(client):
    thandi = login(client, THANDI)
    r = client.post("/api/me/panels/SG-0042/transfer", json={"toContact": "+27 79 999 9999"}, headers=thandi)
    assert r.status_code == 404
    client.post("/api/panels/SG-0043/report-stolen", json={"caseRef": "CAS 9"})
    r = client.post("/api/me/panels/SG-0043/transfer", json={"toContact": AYANDA}, headers=thandi)
    assert r.status_code == 409


def test_stolen_report_cancels_pending_offer(client):
    thandi, ayanda = login(client, THANDI), login(client, AYANDA)
    client.post("/api/me/panels/SG-0042/transfer", json={"toContact": AYANDA}, headers=thandi)
    offer_id = client.get("/api/me", headers=ayanda).json()["incoming"][0]["id"]

    client.post("/api/panels/SG-0042/report-stolen", json={"caseRef": "CAS 7"})
    assert client.get("/api/me", headers=ayanda).json()["incoming"] == []
    assert client.post(f"/api/me/transfers/{offer_id}/accept", headers=ayanda).status_code == 409
    assert client.get("/api/panels/SG-0042").json()["ownerName"] == "Thandi Mokoena"


def test_decline_and_cancel(client):
    thandi, ayanda = login(client, THANDI), login(client, AYANDA)
    client.post("/api/me/panels/SG-0042/transfer", json={"toContact": AYANDA}, headers=thandi)
    offer_id = client.get("/api/me", headers=ayanda).json()["incoming"][0]["id"]
    assert client.post(f"/api/me/transfers/{offer_id}/cancel", headers=ayanda).status_code == 403
    assert client.post(f"/api/me/transfers/{offer_id}/decline", headers=ayanda).status_code == 200

    client.post("/api/me/panels/SG-0042/transfer", json={"toContact": AYANDA}, headers=thandi)
    offer_id = client.get("/api/me", headers=thandi).json()["outgoing"][0]["id"]
    assert client.post(f"/api/me/transfers/{offer_id}/cancel", headers=thandi).status_code == 200
    assert client.get("/api/me", headers=ayanda).json()["incoming"] == []


def test_buyer_check_reads_the_registry_not_the_app_table(client):
    r = client.get("/api/lookup/SG-0666").json()
    assert r["result"] == "stolen" and r["verifiedOnRegistry"] and r["matchesRegistry"]

    # Someone edits the app database directly: the buyer still gets the registry's answer.
    client.app.state.sg.db.execute("UPDATE panels SET status = 'clean' WHERE serial = 'SG-0666'")
    r = client.get("/api/lookup/SG-0666").json()
    assert r["result"] == "stolen"
    assert r["matchesRegistry"] is False


def test_restore_from_chain_events(client):
    """After a disk wipe, panels and history come back from registry events alone."""
    import asyncio

    from app.chain import owner_hash
    from app.seed import restore_from_chain

    sg = client.app.state.sg
    thandi, stranger = owner_hash("+27 71 000 0042"), owner_hash("+27 60 123 4567")
    ev = lambda action, serial, i, **kw: {"action": action, "serial": serial, "txHash": f"0x{i:064x}",  # noqa: E731
                                          "ts": 1_800_000_000.0 + i, "registrar": "0x" + "ab" * 20, **kw}
    events = [
        ev("registerPanel", "SG-0042", 1, ownerHash=thandi),
        ev("registerPanel", "SG-7777", 2, ownerHash=stranger),
        ev("transferOwnership", "SG-7777", 3, fromOwner=stranger, ownerHash=thandi),
        ev("reportStolen", "SG-0042", 4, caseRef="CAS 1"),
    ]
    assert asyncio.run(restore_from_chain(sg, None, events)) == 2

    p = client.get("/api/panels/SG-0042").json()
    assert p["ownerName"] == "Thandi Mokoena" and p["area"] == "Soweto" and p["status"] == "stolen"
    p = client.get("/api/panels/SG-7777").json()
    assert p["ownerName"] == "Thandi Mokoena" and p["area"] == "Unknown area"
    assert [e["kind"] for e in p["history"]] == ["transferred", "registered"]
