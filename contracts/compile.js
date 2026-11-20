// Compiles SolarRegistry.sol with the bundled solc-js and writes the ABI and
// bytecode to build/ and to the backend, so both stay in sync. Also writes the
// exact Standard JSON input to build/verify-input.json for explorer verification.
const fs = require("fs");
const path = require("path");
const solc = require("solc");

const SOLC_VERSION = "0.8.24";
if (!solc.version().startsWith(SOLC_VERSION + "+")) {
  console.error(`Expected solc ${SOLC_VERSION}, found ${solc.version()}. Run npm ci.`);
  process.exit(1);
}

// Load the contract and every file it imports, recursively, so the input is
// self-contained. "@openzeppelin/..." resolves from node_modules; relative
// imports resolve against the importing file's source unit name.
const sources = {};
function load(unit) {
  if (sources[unit]) return;
  const file = unit.startsWith("@") ? require.resolve(unit) : path.join(__dirname, unit);
  const content = fs.readFileSync(file, "utf8");
  sources[unit] = { content };
  for (const [, imp] of content.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm)) {
    load(imp.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(unit), imp)) : imp);
  }
}
load("SolarRegistry.sol");

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: "paris", // widest EVM compatibility (Avalanche C-Chain, local test chains)
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const inputJson = JSON.stringify(input);

const out = JSON.parse(solc.compile(inputJson));
const errors = (out.errors || []).filter((e) => e.severity === "error");
if (errors.length) {
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}

const c = out.contracts["SolarRegistry.sol"].SolarRegistry;
const artifact = { abi: c.abi, bytecode: "0x" + c.evm.bytecode.object };

fs.mkdirSync(path.join(__dirname, "build"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "build", "SolarRegistry.json"), JSON.stringify(artifact, null, 2));
fs.writeFileSync(path.join(__dirname, "build", "verify-input.json"), inputJson);

const backendTarget = path.join(__dirname, "..", "backend", "app", "SolarRegistry.abi.json");
fs.mkdirSync(path.dirname(backendTarget), { recursive: true });
fs.writeFileSync(backendTarget, JSON.stringify(c.abi, null, 2));

console.log(`Compiled SolarRegistry (${artifact.bytecode.length / 2 - 1} bytes, ${Object.keys(sources).length} source files)`);
