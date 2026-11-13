// Deploys and funds the PolicyWallet on the local practice chain, allowlists
// the seller, and writes deployments/agent.json for the agent + owner scripts.
const { ethers } = require("hardhat");
const fs = require("fs");

// Policy (fake ETH): agent may spend up to 0.02 alone, 0.05 total per hour.
const WINDOW_LIMIT = ethers.parseEther("0.05");
const WINDOW_SECONDS = 3600n;
const CO_SIGN_ABOVE = ethers.parseEther("0.02");
const STARTING_BALANCE = ethers.parseEther("1");

async function main() {
  const signers = await ethers.getSigners();
  const [owner, agent, seller] = signers;

  const Wallet = await ethers.getContractFactory("PolicyWallet", owner);
  const wallet = await Wallet.deploy(
    agent.address,
    WINDOW_LIMIT,
    WINDOW_SECONDS,
    CO_SIGN_ABOVE,
    { value: STARTING_BALANCE }
  );
  await wallet.waitForDeployment();
  const address = await wallet.getAddress();

  // Owner allowlists the data seller.
  await (await wallet.connect(owner).setPayee(seller.address, true)).wait();

  const deployment = {
    wallet: address,
    owner: owner.address,
    agent: agent.address,
    seller: seller.address,
    // Hardhat's default accounts in order (public test keys, fake chain only).
    ownerKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    agentKey: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    rpc: "http://127.0.0.1:8545",
  };
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync("deployments/agent.json", JSON.stringify(deployment, null, 2));

  console.log("PolicyWallet deployed:", deployment);
  console.log('Next: npm run data-api, then LLM_FAKE=1 npm run agent -- "What will the weather be in Kiambu this week?"');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
