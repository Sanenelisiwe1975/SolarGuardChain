// Compiles SolarRegistry.sol with the bundled solc-js and writes the ABI and
// bytecode to build/ and to the backend, so both stay in sync.
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const source = fs.readFileSync(path.join(__dirname, "SolarRegistry.sol"), "utf8");
const input = {
  language: "Solidity",
  sources: { "SolarRegistry.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris", // widest EVM compatibility (Avalanche C-Chain, local test chains)
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (out.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}

const c = out.contracts["SolarRegistry.sol"].SolarRegistry;
const artifact = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };

fs.mkdirSync(path.join(__dirname, "build"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "build", "SolarRegistry.json"), JSON.stringify(artifact, null, 2));

const backendTarget = path.join(__dirname, "..", "backend", "app", "SolarRegistry.abi.json");
fs.mkdirSync(path.dirname(backendTarget), { recursive: true });
fs.writeFileSync(backendTarget, JSON.stringify(c.abi, null, 2));

console.log(`Compiled SolarRegistry (${artifact.bytecode.length / 2 - 1} bytes)`);
