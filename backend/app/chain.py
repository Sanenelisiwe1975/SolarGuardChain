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
    def info(self) -> dict: ...


def owner_hash(contact: str) -> str:
    """Salted SHA-256 of the owner's contact, as 0x-prefixed bytes32 hex."""
    digest = hashlib.sha256(f"{settings.owner_salt}:{contact.strip().lower()}".encode()).hexdigest()
    return "0x" + digest


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

    def _send(self, fn) -> str:
        tx = fn.build_transaction(
            {
                "from": self.account.address,
                "nonce": self.w3.eth.get_transaction_count(self.account.address, "pending"),
                "chainId": self.w3.eth.chain_id,
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

    def info(self) -> dict:
        address = self.contract.address
        return {
            "mode": self.mode,
            "label": self.label,
            "network": "Avalanche Fuji C-Chain (testnet)",
            "contractAddress": address,
            "explorerUrl": f"{settings.explorer_base}/address/{address}",
            "relayer": self.account.address,
        }


def make_registry(db: Database) -> RegistryClient:
    if settings.chain_mode == "fuji":
        if not (settings.registry_address and settings.relayer_private_key):
            log.warning("CHAIN_MODE=fuji but REGISTRY_ADDRESS/RELAYER_PRIVATE_KEY missing; using local ledger")
            return LocalLedger(db)
        return FujiRegistry()
    return LocalLedger(db)
