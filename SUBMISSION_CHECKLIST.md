# BACISS 2026 submission checklist: SolarGuard

Checked by Claude Code on 20 November 2026. `[x]` verified, `[~]` partly done (note follows), `[ ]` not done or not checkable from the repo.

Deadline: Demo Day, Saturday 21 November 2026. Seven-minute pitch plus three minutes of Q&A. Eligibility gate: without a working Fuji deployment, the team cannot win any prize.

> **Explorer note:** `testnet.snowscan.xyz` does not exist (DNS returns NXDOMAIN); Snowscan only covers mainnet. The Fuji explorer is **Snowtrace**, `https://testnet.snowtrace.io` (run by Routescan). Read "Snowscan" below as Snowtrace.

## A. Avalanche submission requirements (all five are mandatory)

### A1. Deployed contract on Fuji, with an explorer link
- [x] SolarRegistry is deployed to Avalanche Fuji C-Chain (chain ID 43113): `0x1F9F13Ba36A6E65E319C4D02a7B7a4835DDF4187`, block 61393402
- [x] The contract address is written in README.md under "Submission"
- [~] Explorer link is in README.md: uses `https://testnet.snowtrace.io/address/0x1F9F…4187`, because the Snowscan testnet domain doesn't exist
- [ ] The source code is verified. Submitted through Routescan's API on 20 Nov (Standard JSON input, 0.8.24, `contracts/build/verify-input.json`), but it stayed "Pending in queue". Check the contract page; if it's still unverified, use **Verify & publish** on Snowtrace with the same file
- [x] backend/.env has CHAIN_MODE=fuji, REGISTRY_ADDRESS, RELAYER_PRIVATE_KEY and CHAIN_ID=43113
- [ ] With the backend running, GET /api/stats shows "mode": "fuji" and "chainId": 43113. Not run yet on purpose: the first Fuji start writes the demo data on-chain with owner hashes, so change OWNER_SALT first (see A5). Verified on a local 43113 chain: `mode: fuji`, `chainId: 43113`
- [x] The relayer wallet has REGISTRAR_ROLE: `isRegistrar(0x780f…81ea7)` returns true on Fuji
- [x] The relayer wallet holds enough test AVAX for at least 20 transactions: about 0.5 AVAX, at roughly 0.00000000002 AVAX per registerPanel

### A2. GitHub repository with source code, README and basic tests
- [x] The repo is pushed to GitHub and is public (github.com/Sanenelisiwe1975/SolarGuardChain loads without signing in)
- [x] .env is not committed: `git ls-files | grep -E "(^|/)\.env$"` prints nothing
- [x] No private keys anywhere in git history: the grep finds 0 matches across all branches
- [x] .gitignore covers node_modules, .venv, dist, backend/data, .env, contracts/build
- [x] README.md explains how to run the app, deploy to Fuji, and run the tests
- [x] Contract tests pass: **15 passing** (the checklist expected 13; 4 pause and role tests were added)
- [x] Backend tests pass: **21 passed** (the checklist expected 11)
- [x] Frontend builds: `npm run build` with no TypeScript errors

### A3. Live demo of at least two state-changing transactions, plus the track workflow
These need the backend running on Fuji, after OWNER_SALT is changed. The first start already sends registerPanel ×4, transferOwnership ×1 and reportStolen ×1.
- [ ] registerPanel works on Fuji from the Register screen and appears on the explorer
- [ ] reportStolen works on Fuji (via an alert's "Report stolen" or the panel page) and appears on the explorer
- [ ] transferOwnership works on Fuji (bonus third transaction)
- [ ] markRecovered works on Fuji (bonus fourth transaction)
- [~] Each transaction in the ownership history links to its explorer page: the code builds `EXPLORER_BASE/tx/<hash>` (Snowtrace); not yet seen on real Fuji
- [~] The Check screen shows "Confirmed on Avalanche Fuji" for a stolen serial: verified in a browser against a local 43113 chain; not yet on real Fuji
- [ ] Ask the organisers on Saturday morning what "the required track workflow" means, and map it to the demo. Write the answer here: ____________

### A4. Short explanation: user problem, why Avalanche, next milestone
- [x] README.md has a "Submission" section with all three parts:
  - [x] Problem: panel theft by syndicates, resale with no way for buyers to check a serial, and losses to owners, providers and insurers
  - [x] Why Avalanche: fast finality, low fees, EVM with audited OpenZeppelin code, one shared record no single party controls, and a growth path to a dedicated Avalanche L1 where only accredited installers, insurers and SAPS can write
  - [x] Next milestone: a paid 30-site pilot with one solar provider using the ESP32 sensor, then multisig admin and an audit before mainnet
- [ ] The same three points are on the pitch slides

### A5. No real funds or personal customer information
- [x] Only test AVAX is used. `.env` points at the Fuji RPC; the deploy script refuses any chain but 43113
- [x] Demo data in backend/app/seed.py is clearly fictional (phone numbers end in the panel number, the case number is marked "fictional", the installer is marked "demo")
- [x] Nothing personal goes on-chain: the contract stores only the owner hash, registrar, timestamps, transfer count and status; the serial and case reference are in events
- [x] The Register form tells users "Demo: use mock names and numbers only" (added 20 Nov)
- [x] The public lookup returns no names or phone numbers: `test_lookup_hides_personal_data` passes
- [ ] OWNER_SALT in .env is changed from the default value. **Still the default.** Change it before the first Fuji start, and use the same value on Render

## B. Avalanche judging rubric

### B1. Contract functionality and successful deployment (40%)
- [~] All of A1 and A3 is done: the contract is deployed and correct; verification and the live transactions are still to do
- [~] Reads work without a wallet: `getPanel` works over the public RPC. The explorer's "Read contract" tab only appears once the source is verified
- [~] Rule enforced on-chain: a stolen panel cannot be transferred (PanelIsStolen). Passes in the tests; check on Fuji after seeding (SG-0666)
- [~] Rule enforced on-chain: a duplicate registration reverts with AlreadyRegistered. Passes in the tests; check on Fuji after seeding (SG-0042)

### B2. Practical usefulness and clarity of the problem (25%)
- [ ] The pitch names the paying customer (solar subscription providers, then insurers)
- [ ] The pitch uses sourced evidence (syndicate reports, insurers' tracing problem, theft slowing solar adoption)
- [~] The demo shows the buyer moment: scanning a stolen serial gives "Reported stolen". The app supports it (SG-0666); rehearse it on Fuji

### B3. Technical quality, access control and basic tests (20%)
- [x] The contract uses OpenZeppelin AccessControl with REGISTRAR_ROLE, and Pausable
- [x] Every write function is onlyRole(REGISTRAR_ROLE) whenNotPaused
- [x] Tests cover: unauthorised caller, duplicate registration, stolen panel can't transfer, pause/unpause, revoked role
- [~] Live proof of access control: simulating registerPanel and pause on Fuji from a wallet without the role reverts with AccessControlUnauthorizedAccount. The explorer's "Write contract" tab needs a verified contract and a second wallet; rehearse once
- [x] The deploy script refuses to run on any chain but 43113, and refuses if the wallet has no funds (zero-funds refusal tested live; the chain check is in the code)

### B4. Differentiation and potential to develop further (15%)
- [ ] The pitch explains the browser check: the buyer's browser reads the contract directly, so the result doesn't depend on trusting our server (built: `OnChainProof` on the Check screen)
- [ ] The pitch covers the growth path to a permissioned Avalanche L1 for accredited registrars

## C. Main BACISS scorecard (each criterion out of 5)
- [ ] Problem definition: clear problem, African relevance (Africa installs about 100,000 panels a day in 2026), named beneficiaries, evidence
- [ ] Technical architecture: the architecture slide is in the deck, and the blockchain's role and the security choices are explained
- [ ] Innovation: the sensor and registry together cover detection and resale; the buyer verifies without trusting the server
- [ ] AI & cloud implementation:
  - [ ] The backend is deployed to a cloud host on a public HTTPS URL. **`solarguard-api.onrender.com` returns 404 with `x-render-routing: no-server`**: no Render service exists at the URL `frontend/vercel.json` forwards to
  - [ ] GEMINI_API_KEY is set on the cloud host, so alerts are AI-written (it is also empty in the local `.env`)
  - [~] The demo shows wind gives no alert and a lift gives an alert: built and covered by the backend tests; rehearse it
  - [~] The demo shows the power-outage switch: built (Demo controls) and tested; rehearse it
  - [ ] Training data has been recorded from the Sensor screen (at least 5 wind and 5 theft recordings). The recording and download feature exists; recordings can't be checked from the repo
- [ ] Pitch delivery: rehearsed to 6:30, all five team members know the Q&A answers (section E)

## D. Demo readiness (check on Saturday morning)
- [ ] The cloud URL loads on a laptop and on a phone
- [ ] The phone sensor runs at <cloud URL>/sensor over HTTPS and motion permission is granted
- [ ] Demo panel SG-0042 is clean, with no open alerts (use Restore demo data, or a fresh contract if on Fuji)
- [ ] Props ready: a board or panel with the serial label, tape, a fan, two charged phones, a hotspot
- [ ] WhatsApp sandbox joined from the owner phone, if WhatsApp is used
- [ ] Backup video of the whole flow recorded and saved offline on the laptop
- [~] Backup without a phone: `uv run python scripts/simulate.py <cloud URL> SG-0042`. The script takes a URL and a serial; not yet tested against a cloud URL
- [ ] Explorer tab open on the contract page, and a second wallet ready for the access-control demo
- [ ] Contract address and explorer link on the demo slide

## E. Q&A answers the whole team must know
These match how the code and README work; whether the team knows them can't be checked from the repo.
- [ ] "Why not a normal database?" Installers, insurers and police don't trust each other's databases. The contract is one record none of them controls, and no insider can quietly edit it.
- [ ] "Where is the wallet connect?" Owners and buyers shouldn't need a crypto wallet, so a relayer pays the gas. Trust comes from anyone being able to read the contract directly, and each installer or insurer can hold its own registrar role.
- [ ] "What stops a thief peeling off the label?" We use the manufacturer serial laminated under the glass, which can't be removed without destroying the panel.
- [ ] "What if they cut the cable?" The sensor goes silent. The system checks for a power outage, and if there isn't one, the owner is alerted.
- [ ] "Who pays?" Solar subscription providers and insurers pay per protected site. Checking a serial is free.
- [ ] "Is the sensor real?" The prototype is a phone. Production is an ESP32 with a cellular module at roughly R1,000 in parts, sending the same data.
- [ ] "Where is personal data stored?" Off-chain only. The chain holds a salted hash of the owner's contact, and the demo uses mock identities.

## Needs the team
1. **OWNER_SALT**: set a long random value in `backend/.env` **before** the first Fuji start, and the same value on Render. Owner hashes are written on-chain at that first start, so changing the salt afterwards would orphan them.
2. **First Fuji start** (`cd backend && uv run uvicorn app.main:app --port 8000`) to seed the contract, then confirm `/api/stats` and do the A3 transactions from the UI, including markRecovered.
3. **Source verification**: check whether the Routescan submission went through; if not, verify manually on Snowtrace.
4. **Cloud API URL**: deploy the Render service (or point `frontend/vercel.json` at the real URL), and set RELAYER_PRIVATE_KEY, OWNER_SALT and GEMINI_API_KEY there.
5. **Vercel URL**: not in the repo; add it to the README once live.
6. **Track workflow** answer from the organisers (A3).
7. Pitch slides, evidence sources, rehearsal, props, backup video, training recordings, second wallet (B2, B4, C, D, E).
