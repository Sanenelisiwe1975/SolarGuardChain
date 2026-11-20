"""Registry clients.

LocalLedger  – hash-chained, append-only ledger in SQLite. Lets the demo run
               with no network. Clearly labelled as a local ledger in the UI.
FujiRegistry – the SolarRegistry contract on Avalanche Fuji, written through a
               relayer wallet so users never see a wallet or pay gas.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
from dataclasses import dataclass
from typing import Protocol

from .config import ROOT, settings
from .db import Database, now

log = logging.getLogger("solarguard.chain")


@dataclass
class TxResult:
    tx_hash: str
    explorer_url: str | None


class RegistryClient(Protocol):
    mode: str
    label: str

    async def register(self, serial: str, owner_hash: str) -> TxResult: ...
    async def transfer(self, serial: str, new_owner_hash: str) -> TxResult: ...
    async def report_stolen(self, serial: str, case_ref: str) -> TxResult: ...
    async def recover(self, serial: str) -> TxResult: ...
    async def status(self, serial: str) -> RegistryRecord: ...
    def info(self) -> dict: ...


@dataclass
class RegistryRecord:
    """What the registry itself says about a serial."""
    status: str               # unregistered | clean | stolen
    owner_hash: str | None
    transfers: int


def normalise_contact(contact: str) -> str:
    """One spelling per person: emails lower-cased, SA phone numbers as +27…
    so '071 000 0042' and '+27 71 000 0042' are the same owner."""
    c = contact.strip().lower()
    if "@" in c:
        return c
    digits = re.sub(r"[\s\-().]", "", c)
    if re.fullmatch(r"\+?\d{6,15}", digits):
        if digits.startswith("0"):
            return "+27" + digits[1:]
        return digits if digits.startswith("+") else "+" + digits
    return c


def owner_hash(contact: str) -> str:
    """Salted SHA-256 of the owner's contact, as 0x-prefixed bytes32 hex."""
    digest = hashlib.sha256(f"{settings.owner_salt}:{normalise_contact(contact)}".encode()).hexdigest()
    return "0x" + digest


FUJI_CHAIN_ID = 43113
FUJI_PUBLIC_RPC = "https://api.avax-test.network/ext/bc/C/rpc"


def public_rpc_url() -> str | None:
    """The RPC URL buyers' browsers may use to read the contract themselves.

    Provider URLs often carry an API key, so RPC_URL is only shared when it is
    the public Avalanche endpoint or a local test chain; otherwise browsers get
    the public Fuji endpoint, or nothing on other chains."""
    from urllib.parse import urlsplit

    parts = urlsplit(settings.rpc_url)
    if not (parts.username or parts.password or parts.query) and parts.hostname in (
        "api.avax-test.network", "127.0.0.1", "localhost",
    ):
        return settings.rpc_url
    return FUJI_PUBLIC_RPC if settings.chain_id == FUJI_CHAIN_ID else None


def _hex(v: str) -> int:
    """Indexers write zero as a bare '0x'."""
    v = v.removeprefix("0x")
    return int(v, 16) if v else 0


def _replay(actions: list[tuple[str, dict]]) -> RegistryRecord:
    """Apply registry actions in order, exactly as the contract would."""
    status, owner, transfers = "unregistered", None, 0
    for action, payload in actions:
        if action == "registerPanel":
            status, owner = "clean", payload["ownerHash"]
        elif action == "transferOwnership":
            owner, transfers = payload["ownerHash"], transfers + 1
        elif action == "reportStolen":
            status = "stolen"
        elif action == "markRecovered":
            status = "clean"
    return RegistryRecord(status, owner, transfers)


class LocalLedger:
    mode = "local"
    label = "Local ledger (demo)"

    def __init__(self, db: Database):
        self.db = db

    def _append(self, serial: str, action: str, payload: dict) -> TxResult:
        prev = self.db.one("SELECT hash FROM ledger ORDER BY id DESC LIMIT 1")
        prev_hash = prev["hash"] if prev else "0x" + "0" * 64
        body = json.dumps({"serial": serial, "action": action, **payload}, sort_keys=True)
        ts = now()
        h = "0x" + hashlib.sha256(f"{prev_hash}|{body}|{ts}".encode()).hexdigest()
        self.db.execute(
            "INSERT INTO ledger (serial, action, payload, prev_hash, hash, ts) VALUES (?,?,?,?,?,?)",
            (serial, action, body, prev_hash, h, ts),
        )
        return TxResult(tx_hash=h, explorer_url=None)

    async def register(self, serial: str, owner_hash: str) -> TxResult:
        return self._append(serial, "registerPanel", {"ownerHash": owner_hash})

    async def transfer(self, serial: str, new_owner_hash: str) -> TxResult:
        return self._append(serial, "transferOwnership", {"ownerHash": new_owner_hash})

    async def report_stolen(self, serial: str, case_ref: str) -> TxResult:
        return self._append(serial, "reportStolen", {"caseRef": case_ref})

    async def recover(self, serial: str) -> TxResult:
        return self._append(serial, "markRecovered", {})

    async def status(self, serial: str) -> RegistryRecord:
        """Rebuild the panel's state from the ledger alone, not the app tables."""
        if not self.verify():
            raise RuntimeError("Local ledger failed its integrity check")
        rows = self.db.all("SELECT action, payload FROM ledger WHERE serial = ? ORDER BY id", (serial,))
        return _replay([(r["action"], json.loads(r["payload"])) for r in rows])

    def verify(self) -> bool:
        """Recompute every link of the hash chain; False if any row was edited."""
        prev_hash = "0x" + "0" * 64
        for row in self.db.all("SELECT * FROM ledger ORDER BY id"):
            expected = "0x" + hashlib.sha256(f"{prev_hash}|{row['payload']}|{row['ts']}".encode()).hexdigest()
            if row["prev_hash"] != prev_hash or row["hash"] != expected:
                return False
            prev_hash = row["hash"]
        return True

    def info(self) -> dict:
        count = self.db.one("SELECT COUNT(*) AS n FROM ledger")["n"]
        return {
            "mode": self.mode,
            "label": self.label,
            "network": "Local hash-chained ledger",
            "contractAddress": None,
            "explorerUrl": None,
            "chainId": None,
            "rpcUrl": None,
            "entries": count,
            "intact": self.verify(),
        }


class FujiRegistry:
    mode = "fuji"
    label = "Avalanche Fuji"

    def __init__(self):
        from web3 import Web3

        abi = json.loads((ROOT / "app" / "SolarRegistry.abi.json").read_text())
        self.w3 = Web3(Web3.HTTPProvider(settings.rpc_url, request_kwargs={"timeout": 30}))
        self.account = self.w3.eth.account.from_key(settings.relayer_private_key)
        self.contract = self.w3.eth.contract(address=Web3.to_checksum_address(settings.registry_address), abi=abi)
        self._nonce_lock = asyncio.Lock()

        # Refuse to start against the wrong network rather than sign for it.
        self.chain_id = self.w3.eth.chain_id
        if self.chain_id != settings.chain_id:
            raise RuntimeError(
                f"RPC is chain {self.chain_id} but CHAIN_ID is {settings.chain_id}. Check RPC_URL")
        if not self.contract.functions.isRegistrar(self.account.address).call():
            log.warning("Relayer %s is not a registrar on %s; writes will revert. Grant it REGISTRAR_ROLE.",
                        self.account.address, self.contract.address)

    def _send(self, fn) -> str:
        tx = fn.build_transaction(
            {
                "from": self.account.address,
                "nonce": self.w3.eth.get_transaction_count(self.account.address, "pending"),
                "chainId": self.chain_id,
            }
        )
        signed = self.account.sign_transaction(tx)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=60)
        if receipt.status != 1:
            raise RuntimeError("Transaction reverted")
        return "0x" + tx_hash.hex().removeprefix("0x")

    async def _tx(self, fn) -> TxResult:
        async with self._nonce_lock:  # one in-flight tx at a time keeps nonces simple
            tx_hash = await asyncio.to_thread(self._send, fn)
        return TxResult(tx_hash=tx_hash, explorer_url=f"{settings.explorer_base}/tx/{tx_hash}")

    @staticmethod
    def _b32(h: str) -> bytes:
        return bytes.fromhex(h.removeprefix("0x"))

    async def register(self, serial: str, owner_hash: str) -> TxResult:
        return await self._tx(self.contract.functions.registerPanel(serial, self._b32(owner_hash)))

    async def transfer(self, serial: str, new_owner_hash: str) -> TxResult:
        return await self._tx(self.contract.functions.transferOwnership(serial, self._b32(new_owner_hash)))

    async def report_stolen(self, serial: str, case_ref: str) -> TxResult:
        return await self._tx(self.contract.functions.reportStolen(serial, case_ref))

    async def recover(self, serial: str) -> TxResult:
        return await self._tx(self.contract.functions.markRecovered(serial))

    async def status(self, serial: str) -> RegistryRecord:
        """Read the panel straight from the contract (a free view call)."""
        owner, _registrar, _registered, _updated, transfers, status = await asyncio.to_thread(
            self.contract.functions.getPanel(serial).call
        )
        name = ("unregistered", "clean", "stolen")[status]
        return RegistryRecord(name, "0x" + bytes(owner).hex() if status else None, int(transfers))

    def _events_sync(self) -> list[dict]:
        """Every registry event since deployment, oldest first, decoded."""
        import httpx
        from eth_abi import decode
        from web3 import Web3

        layouts = {  # event signature -> (action, non-indexed field names, their ABI types)
            "PanelRegistered(bytes32,string,bytes32,address)":
                ("registerPanel", ["serial", "ownerHash"], ["string", "bytes32"]),
            "OwnershipTransferred(bytes32,string,bytes32,bytes32,address)":
                ("transferOwnership", ["serial", "fromOwner", "ownerHash"], ["string", "bytes32", "bytes32"]),
            "PanelReportedStolen(bytes32,string,string,address)":
                ("reportStolen", ["serial", "caseRef"], ["string", "string"]),
            "PanelRecovered(bytes32,string,address)":
                ("markRecovered", ["serial"], ["string"]),
        }
        by_topic = {Web3.keccak(text=sig).hex().removeprefix("0x"): v for sig, v in layouts.items()}

        events, page = [], 1
        while True:
            r = httpx.get(settings.indexer_api, timeout=30, params={
                "module": "logs", "action": "getLogs", "address": self.contract.address,
                "fromBlock": settings.registry_from_block, "toBlock": "latest", "page": page, "offset": 1000,
            })
            r.raise_for_status()
            body = r.json()
            result = body.get("result")
            if not isinstance(result, list):
                if "no records" in str(body.get("message", "")).lower():
                    break
                raise RuntimeError(f"Indexer error: {body.get('message')} {result}")
            for log in result:
                layout = by_topic.get(log["topics"][0].removeprefix("0x"))
                if not layout:
                    continue  # role changes, pauses and anything unrelated
                action, names, types = layout
                values = decode(types, bytes.fromhex(log["data"].removeprefix("0x")))
                e = {"action": action, "txHash": log["transactionHash"], "ts": float(_hex(log["timeStamp"])),
                     "block": _hex(log["blockNumber"]), "index": _hex(log["logIndex"]),
                     "registrar": "0x" + log["topics"][-1][-40:]}
                for name, value in zip(names, values):
                    e[name] = "0x" + value.hex() if isinstance(value, bytes) else value
                events.append(e)
            if len(result) < 1000:
                break
            page += 1
        events.sort(key=lambda e: (e["block"], e["index"]))
        return events

    async def events(self) -> list[dict]:
        return await asyncio.to_thread(self._events_sync)

    async def panel_count(self) -> int:
        """Read from the contract itself; the indexer can lag a few minutes behind."""
        return int(await asyncio.to_thread(self.contract.functions.panelCount().call))

    def info(self) -> dict:
        address = self.contract.address
        return {
            "mode": self.mode,
            "label": self.label,
            "network": "Avalanche Fuji C-Chain (testnet)" if self.chain_id == FUJI_CHAIN_ID else f"EVM chain {self.chain_id}",
            "contractAddress": address,
            "explorerUrl": f"{settings.explorer_base}/address/{address}",
            "chainId": self.chain_id,
            "rpcUrl": public_rpc_url(),
            "relayer": self.account.address,
        }


def make_registry(db: Database) -> RegistryClient:
    if settings.chain_mode == "fuji":
        if not (settings.registry_address and settings.relayer_private_key):
            log.warning("CHAIN_MODE=fuji but REGISTRY_ADDRESS/RELAYER_PRIVATE_KEY missing; using local ledger")
            return LocalLedger(db)
        return FujiRegistry()
    return LocalLedger(db)
