// Deploys SolarRegistry to Avalanche Fuji (chain 43113).
//   RELAYER_PRIVATE_KEY=0x... npm run deploy
// Use a separate dev wallet for this, never one that holds real funds. Get free
// test AVAX first from core.app/tools/testnet-faucet or build.avax.network.
// Prints the contract address and the lines to paste into backend/.env.
// Any other chain (e.g. a local test chain) needs ALLOW_OTHER_CHAIN=1.
const { ethers } = require("ethers");
const artifact = require("./build/SolarRegistry.json");

const RPC = process.env.RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc";
const KEY = process.env.RELAYER_PRIVATE_KEY;
const FUJI = 43113n;
const EXPLORER = "https://testnet.snowscan.xyz";

(async () => {
  if (!KEY) throw new Error("Set RELAYER_PRIVATE_KEY");
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const { chainId } = await provider.getNetwork();
  if (chainId !== FUJI && process.env.ALLOW_OTHER_CHAIN !== "1") {
    throw new Error(`RPC is chain ${chainId}, not Fuji (${FUJI}). Check RPC_URL, or set ALLOW_OTHER_CHAIN=1.`);
  }
  const balance = await provider.getBalance(wallet.address);
  console.log(`Deployer ${wallet.address} on chain ${chainId}, balance ${ethers.formatEther(balance)} AVAX`);
  if (balance === 0n) throw new Error("insufficient funds: get test AVAX from the Fuji faucet");
  console.log("Deploying…");

  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();

  const block = (await contract.deploymentTransaction().wait()).blockNumber;

  console.log(`SolarRegistry deployed: ${address} (block ${block})`);
  console.log(`Explorer: ${EXPLORER}/address/${address}`);
  console.log(`\nAdd to backend/.env:\nCHAIN_MODE=fuji\nREGISTRY_ADDRESS=${address}\nREGISTRY_FROM_BLOCK=${block}`);
  console.log(`\nVerify on ${EXPLORER}: Standard JSON input, compiler 0.8.24, upload build/verify-input.json`);
})().catch((e) => { console.error(e); process.exit(1); });
