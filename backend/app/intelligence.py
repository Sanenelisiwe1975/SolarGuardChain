"""The AI layer: classify motion, check context before alarming, draft the alert.

1. classify()        – wind vs. theft from tilt change and shake strength.
                       Thresholds are tuned from data recorded on the Sensor screen.
2. context_check()   – before a silent sensor becomes a theft alarm, check whether
                       the area has a power outage that explains it.
3. draft_alert()     – plain-language alert. Uses Gemini when a key is set,
                       otherwise a template, so the demo never depends on an API.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

from .config import settings
from .db import Database

log = logging.getLogger("solarguard.ai")

TILT_THEFT_DEG = 25.0
RMS_WIND = 0.6
RMS_THEFT = 2.5


def classify(tilt: float | None, rms: float | None) -> str:
    """Return 'theft', 'wind' or 'normal'. Mirrors the on-device rule so the
    server never trusts a client label blindly."""
    tilt = tilt or 0.0
    rms = rms or 0.0
    if tilt > TILT_THEFT_DEG or rms > RMS_THEFT:
        return "theft"
    if rms > RMS_WIND:
        return "wind"
    return "normal"


@dataclass
class Context:
    outage: bool
    summary: str


def context_check(db: Database, area: str) -> Context:
    """Is there a known power outage in this area right now?

    Demo source: the outage toggle in the app. Production source: an outage
    feed such as EskomSePush or municipal notices, behind this same function."""
    row = db.one("SELECT active FROM outages WHERE area = ?", (area,))
    if row and row["active"]:
        return Context(True, f"Power outage reported in {area}. A silent sensor is expected.")
    return Context(False, f"No power outage reported in {area}. Grid supply should be on.")


TEMPLATES = {
    "movement": (
        "Possible theft: panel {serial}",
        "Panel {serial} at {area} was lifted or tilted ({tilt:.0f}° from its normal position). "
        "This does not look like wind. Check your cameras or call armed response, then report it stolen in SolarGuard.",
    ),
    "signal_lost": (
        "Sensor offline: panel {serial}",
        "The sensor on panel {serial} at {area} stopped reporting and there is no power outage in the area. "
        "This can mean the cable was cut. Check the panel, and report it stolen in SolarGuard if it is gone.",
    ),
}


async def draft_alert(kind: str, panel: dict, ctx: Context | None = None) -> tuple[str, str]:
    title_t, body_t = TEMPLATES[kind]
    fields = {"serial": panel["serial"], "area": panel["area"], "tilt": panel.get("tilt") or 0.0}
    title, body = title_t.format(**fields), body_t.format(**fields)

    if not settings.gemini_api_key:
        return title, body

    prompt = (
        "You write SMS-length security alerts for South African solar panel owners. "
        "Rewrite this alert in plain, calm English, under 60 words, with one clear action. "
        "Do not invent facts.\n\n"
        f"Alert: {body}\nContext: {ctx.summary if ctx else 'n/a'}"
    )
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemini_model}:generateContent"
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            r = await client.post(
                url,
                params={"key": settings.gemini_api_key},
                json={"contents": [{"parts": [{"text": prompt}]}]},
            )
            r.raise_for_status()
            text = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            return title, text or body
    except Exception as exc:  # never let the AI call block an alert
        log.warning("Gemini drafting failed, using template: %s", exc)
        return title, body
