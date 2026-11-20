"""Full demo flow through the HTTP API, on the local ledger."""

import asyncio
import time

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture()
def client(tmp_path):
    app = create_app(db_path=str(tmp_path / "test.db"), run_watchdog=False)
    with TestClient(app) as c:
        yield c


def test_seeded_fleet(client):
    stats = client.get("/api/stats").json()
    assert stats["panels"] == 4
    assert stats["stolen"] == 1
    assert stats["registry"]["mode"] == "local"
    assert stats["registry"]["intact"] is True
    assert stats["registry"]["chainId"] is None
    assert stats["registry"]["rpcUrl"] is None


def test_rpc_url_with_a_key_is_never_shared(monkeypatch):
    import dataclasses

    from app import chain

    def rpc(url, chain_id=43113):
        monkeypatch.setattr(chain, "settings", dataclasses.replace(chain.settings, rpc_url=url, chain_id=chain_id))
        return chain.public_rpc_url()

    assert rpc("https://api.avax-test.network/ext/bc/C/rpc") == "https://api.avax-test.network/ext/bc/C/rpc"
    assert rpc("http://127.0.0.1:8545") == "http://127.0.0.1:8545"
    assert rpc("https://avax-fuji.infura.io/v3/secret") == chain.FUJI_PUBLIC_RPC
    assert rpc("https://api.avax-test.network/ext/bc/C/rpc?apikey=secret") == chain.FUJI_PUBLIC_RPC
    assert rpc("https://rpc.example/secret", chain_id=1) is None


def test_lookup_hides_personal_data(client):
    r = client.get("/api/lookup/sg-0107").json()
    assert r["result"] == "clean"
    assert r["transfers"] == 1
    text = str(r)
    assert "Sipho" not in text and "+27" not in text and "Pieter" not in text


def test_lookup_stolen_and_unregistered(client):
    assert client.get("/api/lookup/SG-0666").json()["result"] == "stolen"
    assert client.get("/api/lookup/NOT-A-PANEL").json()["result"] == "unregistered"


def test_bad_serial_rejected(client):
    assert client.get("/api/lookup/%20%20").status_code == 422


def test_register_transfer_and_block_stolen_transfer(client):
    body = {"serial": "SG-9001", "ownerName": "Test Owner", "ownerContact": "+27 70 000 9001",
            "installer": "Demo Installer", "area": "Soweto"}
    assert client.post("/api/panels", json=body).status_code == 201
    assert client.post("/api/panels", json=body).status_code == 409

    r = client.post("/api/panels/SG-9001/transfer", json={"newOwnerName": "B", "newOwnerContact": "+27 70 111"})
    assert r.status_code == 200 and r.json()["ownerName"] == "B"

    assert client.post("/api/panels/SG-9001/report-stolen", json={"caseRef": "CAS 1"}).status_code == 200
    r = client.post("/api/panels/SG-9001/transfer", json={"newOwnerName": "Thief", "newOwnerContact": "+27 70 999"})
    assert r.status_code == 409

    assert client.post("/api/panels/SG-9001/recover").json()["status"] == "clean"
    kinds = [e["kind"] for e in client.get("/api/panels/SG-9001").json()["history"]]
    assert kinds == ["recovered", "reported_stolen", "transferred", "registered"]


def test_wind_does_not_alert_but_lift_does(client):
    client.post("/api/sensor/events", json={"type": "heartbeat", "serial": "SG-0042", "state": "normal"})
    r = client.post("/api/sensor/events",
                    json={"type": "state_change", "serial": "SG-0042", "to": "wind", "tilt": 3, "rms": 1.1}).json()
    assert r["state"] == "wind" and r["alert"] is None

    r = client.post("/api/sensor/events",
                    json={"type": "state_change", "serial": "SG-0042", "to": "theft", "tilt": 48, "rms": 3.2}).json()
    assert r["state"] == "theft" and r["alert"]["kind"] == "movement"

    # Duplicate theft events do not spam alerts
    r = client.post("/api/sensor/events",
                    json={"type": "state_change", "serial": "SG-0042", "to": "theft", "tilt": 50, "rms": 3.0}).json()
    assert r["alert"] is None
    assert len(client.get("/api/alerts?status=open").json()) == 1


def test_server_overrides_false_client_theft_label(client):
    r = client.post("/api/sensor/events",
                    json={"type": "state_change", "serial": "SG-0043", "to": "theft", "tilt": 2, "rms": 0.1}).json()
    assert r["state"] == "normal" and r["alert"] is None


def test_confirm_alert_flags_panel_stolen_on_ledger(client):
    client.post("/api/sensor/events",
                json={"type": "state_change", "serial": "SG-0042", "to": "theft", "tilt": 60, "rms": 4})
    alert = client.get("/api/alerts?status=open").json()[0]
    assert client.post(f"/api/alerts/{alert['id']}/confirm", json={"caseRef": ""}).json()["status"] == "confirmed"
    assert client.get("/api/lookup/SG-0042").json()["result"] == "stolen"
    assert client.get("/api/stats").json()["registry"]["intact"] is True
    assert client.post(f"/api/alerts/{alert['id']}/confirm").status_code == 409


def test_watchdog_respects_power_outage(client):
    sg = client.app.state.sg
    client.post("/api/sensor/events", json={"type": "heartbeat", "serial": "SG-0042", "state": "normal"})
    sg.db.execute("UPDATE panels SET last_seen = ? WHERE serial = 'SG-0042'", (time.time() - 60,))

    client.post("/api/demo/outages", json={"area": "Soweto", "active": True})
    assert asyncio.run(sg.watchdog_tick()) == []
    assert client.get("/api/panels/SG-0042").json()["sensorState"] == "offline_outage"

    client.post("/api/demo/outages", json={"area": "Soweto", "active": False})
    raised = asyncio.run(sg.watchdog_tick())
    assert len(raised) == 1 and raised[0]["kind"] == "signal_lost"
    assert client.get("/api/panels/SG-0042").json()["sensorState"] == "signal_lost"

    # A new heartbeat brings the sensor back
    client.post("/api/sensor/events", json={"type": "heartbeat", "serial": "SG-0042", "state": "normal"})
    assert client.get("/api/panels/SG-0042").json()["sensorState"] == "normal"


def test_ledger_detects_tampering(client):
    sg = client.app.state.sg
    assert sg.registry.verify() is True
    sg.db.execute("UPDATE ledger SET payload = REPLACE(payload, 'CAS', 'XXX') WHERE action = 'reportStolen'")
    assert sg.registry.verify() is False


def test_unknown_sensor_serial_is_404(client):
    r = client.post("/api/sensor/events", json={"type": "heartbeat", "serial": "SG-NOPE", "state": "normal"})
    assert r.status_code == 404
