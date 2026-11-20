"""SolarGuard API. Serves /api/* and, when built, the web app on the same origin
(one HTTPS URL for laptop, phone and the phone-sensor page)."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from typing import Literal

from fastapi import Depends, FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .accounts import Accounts
from .chain import make_registry
from .config import settings
from .db import Database
from .events import Broadcaster
from .seed import seed
from .service import ServiceError, SolarGuard

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


# ---------- request bodies ----------

class RegisterBody(BaseModel):
    serial: str = Field(min_length=3, max_length=64)
    ownerName: str = Field(min_length=1, max_length=120)
    ownerContact: str = Field(min_length=3, max_length=120)
    installer: str = Field(min_length=1, max_length=120)
    area: str = Field(min_length=1, max_length=80)
    model: str = Field(default="", max_length=80)


class TransferBody(BaseModel):
    newOwnerName: str = Field(min_length=1, max_length=120)
    newOwnerContact: str = Field(min_length=3, max_length=120)


class StolenBody(BaseModel):
    caseRef: str = Field(default="", max_length=80)


class SensorBody(BaseModel):
    type: Literal["heartbeat", "state_change"]
    serial: str = Field(min_length=3, max_length=64)
    state: str | None = None
    to: str | None = None
    tilt: float | None = None
    rms: float | None = None


class OutageBody(BaseModel):
    area: str = Field(min_length=1, max_length=80)
    active: bool


class SignupBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    contact: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=8, max_length=200)


class LoginBody(BaseModel):
    contact: str = Field(min_length=3, max_length=120)
    password: str = Field(min_length=1, max_length=200)


class OfferBody(BaseModel):
    toContact: str = Field(min_length=3, max_length=120)


def _bearer(authorization: str | None) -> str:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


# ---------- app factory ----------

def create_app(db_path: str | None = None, run_watchdog: bool = True) -> FastAPI:
    db = Database(db_path or settings.db_path)
    bus = Broadcaster()
    sg = SolarGuard(db, make_registry(db), bus)
    accounts = Accounts(sg)

    def current_user(authorization: str | None = Header(default=None)) -> dict:
        return accounts.user_for_token(_bearer(authorization))

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        if not db.one("SELECT 1 FROM panels LIMIT 1"):
            await seed(sg, accounts)
        task = None
        if run_watchdog:
            async def loop():
                while True:
                    try:
                        await sg.watchdog_tick()
                    except Exception:  # keep the watchdog alive
                        logging.getLogger("solarguard").exception("watchdog tick failed")
                    await asyncio.sleep(settings.watchdog_interval_s)
            task = asyncio.create_task(loop())
        yield
        if task:
            task.cancel()

    app = FastAPI(title="SolarGuard API", version="1.0.0", lifespan=lifespan)
    app.state.sg = sg
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(ServiceError)
    async def service_error(_: Request, exc: ServiceError):
        return JSONResponse(status_code=exc.status, content={"detail": exc.message})

    # --- read ---
    @app.get("/api/health")
    def health():
        return {"ok": True, "registry": sg.registry.mode}

    @app.get("/api/stats")
    def stats():
        return sg.stats()

    @app.get("/api/panels")
    def panels():
        return sg.list_panels()

    @app.get("/api/panels/{serial}")
    def panel(serial: str):
        return sg.get_panel(serial)

    @app.get("/api/lookup/{serial}")
    async def lookup(serial: str):
        return await sg.lookup(serial)

    @app.get("/api/alerts")
    def alerts(status: str | None = None):
        return sg.list_alerts(status)

    # --- registry commands ---
    @app.post("/api/panels", status_code=201)
    async def register(body: RegisterBody):
        return await sg.register(body.serial, body.ownerName, body.ownerContact, body.installer, body.area, body.model)

    @app.post("/api/panels/{serial}/transfer")
    async def transfer(serial: str, body: TransferBody):
        return await sg.transfer(serial, body.newOwnerName, body.newOwnerContact)

    @app.post("/api/panels/{serial}/report-stolen")
    async def report_stolen(serial: str, body: StolenBody):
        return await sg.report_stolen(serial, body.caseRef)

    @app.post("/api/panels/{serial}/recover")
    async def recover(serial: str):
        return await sg.recover(serial)

    @app.post("/api/alerts/{alert_id}/confirm")
    async def confirm(alert_id: int, body: StolenBody | None = None):
        return await sg.confirm_alert(alert_id, body.caseRef if body else "")

    @app.post("/api/alerts/{alert_id}/dismiss")
    def dismiss(alert_id: int):
        return sg.dismiss_alert(alert_id)

    # --- owner profiles ---
    @app.post("/api/auth/signup", status_code=201)
    def signup(body: SignupBody):
        return accounts.signup(body.name, body.contact, body.password)

    @app.post("/api/auth/login")
    def login(body: LoginBody):
        return accounts.login(body.contact, body.password)

    @app.post("/api/auth/logout")
    def logout(authorization: str | None = Header(default=None)):
        accounts.logout(_bearer(authorization))
        return {"ok": True}

    @app.get("/api/me")
    def me(user: dict = Depends(current_user)):
        return accounts.me(user)

    @app.post("/api/me/panels/{serial}/transfer")
    def offer_transfer(serial: str, body: OfferBody, user: dict = Depends(current_user)):
        return accounts.offer_transfer(user, serial, body.toContact)

    @app.post("/api/me/transfers/{request_id}/accept")
    async def accept_transfer(request_id: int, user: dict = Depends(current_user)):
        return await accounts.accept(user, request_id)

    @app.post("/api/me/transfers/{request_id}/decline")
    def decline_transfer(request_id: int, user: dict = Depends(current_user)):
        return accounts.decline(user, request_id)

    @app.post("/api/me/transfers/{request_id}/cancel")
    def cancel_transfer(request_id: int, user: dict = Depends(current_user)):
        return accounts.cancel(user, request_id)

    # --- sensor ---
    @app.post("/api/sensor/events")
    async def sensor(body: SensorBody):
        state = body.to if body.type == "state_change" else body.state
        return await sg.sensor_event(body.serial, body.type, state, body.tilt, body.rms)

    # --- demo controls ---
    @app.get("/api/demo/outages")
    def outages():
        return sg.outages()

    @app.post("/api/demo/outages")
    def set_outage(body: OutageBody):
        return sg.set_outage(body.area, body.active)

    @app.post("/api/demo/reset")
    async def reset():
        if sg.registry.mode != "local":
            raise ServiceError(409, "On Fuji the chain cannot be reset. Redeploy the contract and delete the database.")
        await seed(sg, accounts)
        bus.publish("reset")
        return {"ok": True}

    # --- live updates ---
    @app.get("/api/stream")
    async def stream(request: Request):
        q = bus.subscribe()

        async def gen():
            try:
                yield "retry: 3000\n\n"
                while True:
                    if await request.is_disconnected():
                        break
                    try:
                        msg = await asyncio.wait_for(q.get(), timeout=15)
                        yield f"data: {msg}\n\n"
                    except asyncio.TimeoutError:
                        yield ": keep-alive\n\n"
            finally:
                bus.unsubscribe(q)

        return StreamingResponse(gen(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    # --- web app (single-page app with client-side routes) ---
    dist = settings.frontend_dist
    if dist.exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse(status_code=404, content={"detail": "Not found"})
            file = dist / path
            if path and file.is_file() and dist in file.resolve().parents:
                return FileResponse(file)
            return FileResponse(dist / "index.html")

    return app


app = create_app()
