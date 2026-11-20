"""In-process pub/sub for Server-Sent Events. Every screen subscribes and
refetches what changed, so the dashboard updates live on phone and laptop."""

from __future__ import annotations

import asyncio
import json


class Broadcaster:
    def __init__(self) -> None:
        self._subscribers: set[asyncio.Queue[str]] = set()

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=100)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self._subscribers.discard(q)

    def publish(self, topic: str, data: dict | None = None) -> None:
        message = json.dumps({"topic": topic, "data": data or {}})
        for q in list(self._subscribers):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                pass  # slow client; it will catch up on the next event
