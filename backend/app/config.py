"""Settings from environment variables (.env is loaded by run scripts or the shell)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


@dataclass(frozen=True)
class Settings:
    db_path: Path = field(default_factory=lambda: Path(os.getenv("DB_PATH", ROOT / "data" / "solarguard.db")))
    owner_salt: str = os.getenv("OWNER_SALT", "solarguard-demo-salt-change-me")

    # Chain: "local" (hash-chained demo ledger) or "fuji" (Avalanche C-Chain testnet)
    chain_mode: str = os.getenv("CHAIN_MODE", "local").lower()
    rpc_url: str = os.getenv("RPC_URL", "https://api.avax-test.network/ext/bc/C/rpc")
    registry_address: str = os.getenv("REGISTRY_ADDRESS", "")
    relayer_private_key: str = os.getenv("RELAYER_PRIVATE_KEY", "")
    explorer_base: str = os.getenv("EXPLORER_BASE", "https://testnet.snowtrace.io")
    # Where to read the contract's past events after a restart. Public RPCs only
    # return 100 blocks of logs per call, so an Etherscan-style indexer is used.
    registry_from_block: int = int(os.getenv("REGISTRY_FROM_BLOCK", "0"))
    indexer_api: str = os.getenv("INDEXER_API", "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api")

    # Sensor timing
    heartbeat_timeout_s: float = float(os.getenv("HEARTBEAT_TIMEOUT_S", "10"))
    watchdog_interval_s: float = float(os.getenv("WATCHDOG_INTERVAL_S", "2"))

    # Optional integrations (all off when empty)
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    twilio_sid: str = os.getenv("TWILIO_ACCOUNT_SID", "")
    twilio_token: str = os.getenv("TWILIO_AUTH_TOKEN", "")
    twilio_from: str = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")
    alert_whatsapp_to: str = os.getenv("ALERT_WHATSAPP_TO", "")

    frontend_dist: Path = field(default_factory=lambda: Path(os.getenv("FRONTEND_DIST", ROOT.parent / "frontend" / "dist")))


settings = Settings()
