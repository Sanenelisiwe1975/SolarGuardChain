// Deploys SolarRegistry to Avalanche Fuji (or any EVM RPC).
//   RELAYER_PRIVATE_KEY=0x... node deploy.js
// Get free test AVAX from the Fuji faucet first. Prints the contract address
// to paste into backend/.env as REGISTRY_ADDRESS.
const { ethers } = require("ethers");
const artifact = require("./build/SolarRegistry.json");

const RPC = process.env.RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const KEY = process.env.RELAYER_PRIVATE_KEY;

(async () => {
  if (!KEY) throw new Error("Set RELAYER_PRIVATE_KEY");
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const { chainId } = await provider.getNetwork();
  console.log(`Deploying from ${wallet.address} on chain ${chainId}…`);

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`SolarRegistry deployed: ${address}`);
  if (chainId === 43113n) console.log(`Explorer: https://testnet.snowtrace.io/address/${address}`);
  console.log(`\nAdd to backend/.env:\nREGISTRY_ADDRESS=${address}`);
})().catch((e) => { console.error(e); process.exit(1); });
