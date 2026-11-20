# SolarGuard

Protects solar panels and lets anyone check whether a second-hand panel is stolen.

- **Sensor** on the panel tells wind apart from someone lifting it, and sends a heartbeat.
- **Watchdog** notices a silent sensor and checks for a power outage before it raises an alarm.
- **Owner alert** (in-app, plus WhatsApp if configured). The owner confirms, and the panel is reported stolen.
- **Registry** keyed by the manufacturer serial laminated under the glass. It stores anonymous owner IDs only, never names or phone numbers.
- **Buyer check**: scan or type a serial and get Clean, Reported stolen, or Not registered, with the ownership history.

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
cd backend && cp .env.example .env && uv sync
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

## Put the registry on Avalanche Fuji

```bash
cd contracts && npm ci
npm test                                   # compile + 11 contract tests
RELAYER_PRIVATE_KEY=0x... npm run deploy   # needs test AVAX from the Fuji faucet
```

Then set these in `backend/.env`, delete `backend/data/solarguard.db`, and restart:

```
CHAIN_MODE=fuji
REGISTRY_ADDRESS=0x...        # printed by the deploy
RELAYER_PRIVATE_KEY=0x...
```

Every registry action now becomes a Fuji transaction with a Snowtrace link in the ownership history. The relayer pays gas, so users never see a wallet. To reset on Fuji, redeploy the contract and delete the database.

## Optional integrations

| Feature | Settings in `backend/.env` | Without it |
|---|---|---|
| WhatsApp alerts | `TWILIO_*` and `ALERT_WHATSAPP_TO`. Join the Twilio sandbox from the owner phone first. | In-app alert and phone vibration only |
| AI-written alert text | `GEMINI_API_KEY` | Fixed template text |

## Demo script (3 minutes)

1. **Fleet:** four panels, one already reported stolen.
2. **Wind:** fan on the panel. The sensor shows Wind and no alert is raised.
3. **Theft:** lift the panel. An alert arrives on the dashboard (and WhatsApp). Tap **Report stolen** and the history gains a registry entry.
4. **Resale:** hand a judge the phone, open **Check**, and scan or type SG-0042. Result: **Reported stolen**.
5. **Cable cut:** put the sensor phone in airplane mode. After about 10 s you get a signal-lost alert. Then switch on a Soweto outage in **Demo controls** and repeat: the panel goes quietly offline, with no false alarm.

Record a backup video of this run before the pitch.

## Tests

```bash
cd backend && uv run pytest        # 11 API tests: full flow, privacy, watchdog, tamper detection
cd contracts && npm test           # 11 contract tests
```

## Honest limits (say these before the judges ask)

- The prototype sensor is a phone. The production node is an ESP32 with an accelerometer and a cellular module, sending the same JSON.
- There is no login yet. The dashboard is the provider's view of their fleet.
- The outage check uses the demo toggle. In production, the same function reads an outage feed.
- The local ledger is tamper-evident (hash-chained), not decentralised. Fuji mode is the real registry.

All names, phone numbers and case numbers in the demo data are fictional.
