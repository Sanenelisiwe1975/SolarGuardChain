# SolarGuard

Protects solar panels and lets anyone check whether a second-hand panel is stolen.

- **Sensor** on the panel tells wind apart from someone lifting it, and sends a heartbeat.
- **Watchdog** notices a silent sensor and checks for a power outage before it raises an alarm.
- **Owner alert** (in-app, plus WhatsApp if configured). The owner confirms, and the panel is reported stolen.
- **Registry** keyed by the manufacturer serial laminated under the glass. It stores anonymous owner IDs only, never names or phone numbers.
- **Buyer check**: scan or type a serial and get Clean, Reported stolen, or Not registered, with the ownership history. The verdict is read from the registry itself (the contract on Fuji), not from the app's database.
- **Owner profiles**: owners sign up with the phone number or email their installer registered, and their panels appear automatically. To sell a panel, the owner sends it to the buyer's profile; the registry only changes once the buyer accepts. Stolen panels cannot be sent, and reporting a panel stolen cancels any pending transfer.

Works on phones and laptops: the same web app, installable to the home screen.

```
contracts/   SolarRegistry.sol, compile, tests (11), Fuji deploy script
backend/     FastAPI: registry, sensor events, watchdog, AI layer, live updates; serves the web app
frontend/    React + TypeScript + Tailwind, mobile-first
```

## Run it (about 5 minutes)

You need Node 20+, and [uv](https://docs.astral.sh/uv/) for Python.

```bash
# 1. Build the web app
cd frontend && npm ci && npm run build && cd ..

# 2. Start the API (it also serves the web app). Demo data loads on the first run.
cd backend && cp .env.example .env && uv sync   # project in OneDrive? link-mode=copy is already set in pyproject.toml
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open http://localhost:8000.

For frontend development with hot reload, keep the API running and run `npm run dev` in `frontend/`. It proxies `/api` to port 8000.

## The phone sensor needs HTTPS

Phones only share motion sensors with HTTPS pages. Tunnel the server:

```bash
ngrok http 8000
```

Open `https://<your-id>.ngrok-free.app/sensor` on the phone that sits on the panel. Choose SG-0042 and tap **Start sensor**. Use the same URL on the laptop for the dashboard: one origin serves everything.

**No phone available?** Run `uv run python scripts/simulate.py`. It plays out normal → wind → theft.

## Deploy: Vercel (web app) + Render (API)

People use one Vercel URL. Vercel serves the web app and forwards `/api` to the API on Render, which runs as a normal server so the watchdog and live updates keep working.

**1. API on Render** (`render.yaml`, Docker):
1. In Render: **New → Blueprint**, pick this repo.
2. When asked, paste `RELAYER_PRIVATE_KEY` and `OWNER_SALT`, using the **same values as `backend/.env`**. A different salt breaks owner IDs.
3. Wait for `https://solarguard-api.onrender.com/api/health` to answer. If Render gave the service a different URL, update the `/api` rewrite in `frontend/vercel.json`.

**2. Web app on Vercel** (`frontend/vercel.json`):
1. In Vercel: **Add New → Project**, import this repo, set **Root Directory** to `frontend`, and deploy.
2. Open the Vercel URL on a phone: it is HTTPS, so the phone sensor works without ngrok.

On a restart, Render's free plan starts with an empty disk. The API then rebuilds every panel and its history from the contract's events on Fuji (read through the Routescan indexer from `REGISTRY_FROM_BLOCK`), so the registry is never lost and nothing is re-registered. Owner profiles, sessions and alerts do reset, but an owner who signs up again with the same phone number gets their panels back. A free Render service also sleeps after 15 idle minutes, so the first request after that takes about a minute.

## Put the registry on Avalanche Fuji

```bash
cd contracts && npm ci
npm test                                   # compile + 11 contract tests
RELAYER_PRIVATE_KEY=0x... npm run deploy   # needs test AVAX from the Fuji faucet
```

Then set these in `backend/.env` and restart:

```
CHAIN_MODE=fuji
REGISTRY_ADDRESS=0x...          # printed by the deploy
REGISTRY_FROM_BLOCK=...         # the deploy's block number (find it on Snowtrace)
RELAYER_PRIVATE_KEY=0x...
DB_PATH=data/solarguard-fuji.db # a fresh database file for this contract
```

On a brand-new contract the first start writes the demo data on-chain once. After that, every registry action becomes a Fuji transaction with a Snowtrace link in the ownership history. The relayer pays gas, so users never see a wallet. To reset on Fuji, redeploy the contract and point `DB_PATH` at a new file. Also update `render.yaml` with the new address and block.

The tests always run on the local ledger (`backend/tests/conftest.py`), even when `.env` is set to Fuji.

**Live contract:** [`0xC5b0c5A4CC98d6eD8Ba8860e57145fCc069B06C7`](https://testnet.snowtrace.io/address/0xC5b0c5A4CC98d6eD8Ba8860e57145fCc069B06C7) on Fuji.

## Optional integrations

| Feature | Settings in `backend/.env` | Without it |
|---|---|---|
| WhatsApp alerts | `TWILIO_*` and `ALERT_WHATSAPP_TO`. Join the Twilio sandbox from the owner phone first. | In-app alert and phone vibration only |
| AI-written alert text | `GEMINI_API_KEY` | Fixed template text |

## Demo script (4 minutes)

1. **Fleet:** four panels, one already reported stolen.
2. **Wind:** fan on the panel. The sensor shows Wind and no alert is raised.
3. **Theft:** lift the panel. An alert arrives on the dashboard (and WhatsApp). Tap **Report stolen** and the history gains a registry entry.
4. **Resale:** hand a judge the phone, open **Check**, and scan or type SG-0042. Result: **Reported stolen**.
5. **Honest sale:** open **Me** and log in as Thandi (`071 000 0042`). Send SG-0043 to Ayanda (`074 000 0200`). Log in as Ayanda in another browser and tap **Accept**. **Check** SG-0043 now shows one change of owner. Both demo passwords are `solarguard`.
6. **Cable cut:** put the sensor phone in airplane mode. After about 10 s you get a signal-lost alert. Then switch on a Soweto outage in **Demo controls** and repeat: the panel goes quietly offline, with no false alarm.

Record a backup video of this run before the pitch.

## Tests

```bash
cd backend && uv run pytest        # 19 API tests: full flow, privacy, watchdog, tamper detection, profiles, transfers
cd contracts && npm test           # 11 contract tests
```

## Honest limits (say these before the judges ask)

- The prototype sensor is a phone. The production node is an ESP32 with an accelerometer and a cellular module, sending the same JSON.
- Owners have profiles, but the fleet dashboard and Register page have no login yet: they are the installer's view.
- The outage check uses the demo toggle. In production, the same function reads an outage feed.
- The local ledger is tamper-evident (hash-chained), not decentralised. Fuji mode is the real registry.

All names, phone numbers and case numbers in the demo data are fictional.
