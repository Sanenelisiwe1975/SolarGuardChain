"""WhatsApp alerts through the Twilio sandbox. Silently skipped when not configured."""

from __future__ import annotations

import logging

import httpx

from .config import settings

log = logging.getLogger("solarguard.notify")


async def send_whatsapp(text: str) -> bool:
    if not (settings.twilio_sid and settings.twilio_token and settings.alert_whatsapp_to):
        return False
    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_sid}/Messages.json"
    to = settings.alert_whatsapp_to
    if not to.startswith("whatsapp:"):
        to = f"whatsapp:{to}"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(
                url,
                auth=(settings.twilio_sid, settings.twilio_token),
                data={"From": settings.twilio_from, "To": to, "Body": text},
            )
            r.raise_for_status()
            return True
    except Exception as exc:
        log.warning("WhatsApp send failed: %s", exc)
        return False
