"""Tests always run on the local ledger, whatever backend/.env says.

This runs before app.config is imported, and config only fills in values that
are not already set, so these win over .env. Without it, a .env in Fuji mode
would make the tests send real transactions."""

import os

os.environ["CHAIN_MODE"] = "local"
os.environ["REGISTRY_ADDRESS"] = ""
os.environ["RELAYER_PRIVATE_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""
os.environ["TWILIO_ACCOUNT_SID"] = ""
os.environ["ALERT_WHATSAPP_TO"] = ""
