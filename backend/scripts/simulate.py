"""Backup demo without a phone: plays a sensor through wind, then theft.

    uv run python scripts/simulate.py                 # against http://127.0.0.1:8000
    uv run python scripts/simulate.py https://xyz.ngrok.app SG-0042
"""

import sys
import time

import httpx

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
SERIAL = sys.argv[2] if len(sys.argv) > 2 else "SG-0042"


def send(body: dict) -> None:
    r = httpx.post(f"{BASE}/api/sensor/events", json={"serial": SERIAL, **body}, timeout=10)
    r.raise_for_status()
    out = r.json()
    print(f"{body['type']:<12} -> state={out['state']}" + (f"  ALERT: {out['alert']['title']}" if out.get("alert") else ""))


def beats(seconds: int, state: str) -> None:
    for _ in range(seconds // 2):
        send({"type": "heartbeat", "state": state})
        time.sleep(2)


print(f"Simulating sensor on {SERIAL} at {BASE}")
send({"type": "heartbeat", "state": "normal"})
beats(6, "normal")
print("-- fan on (wind)")
send({"type": "state_change", "from": "normal", "to": "wind", "tilt": 4, "rms": 1.2})
beats(6, "wind")
send({"type": "state_change", "from": "wind", "to": "normal", "tilt": 1, "rms": 0.1})
beats(4, "normal")
print("-- panel lifted (theft)")
send({"type": "state_change", "from": "normal", "to": "theft", "tilt": 47, "rms": 3.4})
beats(4, "theft")
print("Done. Open Alerts to report it stolen. Stop here and the watchdog will also flag signal lost.")
