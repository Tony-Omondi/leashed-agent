// Shared helpers: load the deployment, build contract instances, pretty errors.
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// Minimal ABI the off-chain code needs (names must match PolicyWallet.sol).
const ABI = [
  "function pay(address payee, uint256 amount, string reason)",
  "function requestPayment(address payee, uint256 amount, string reason) returns (uint256)",
  "function approve(uint256 id)",
  "function setPayee(address payee, bool allowed)",
  "function setAgent(address newAgent)",
  "function setPaused(bool paused)",
  "function isAllowedPayee(address) view returns (bool)",
  "function spentInWindow() view returns (uint256)",
  "function windowLimit() view returns (uint256)",
  "function coSignAbove() view returns (uint256)",
  "function paused() view returns (bool)",
  "function requestCount() view returns (uint256)",
  "function requests(uint256) view returns (address payee, uint256 amount, string reason, bool done)",
  "event Paid(address indexed payee, uint256 amount, string reason, bool coSigned)",
  "event PaymentRequested(uint256 indexed id, address indexed payee, uint256 amount, string reason)",
];

function loadDeployment() {
  const p = path.join(process.cwd(), "deployments", "agent.json");
  if (!fs.existsSync(p)) {
    throw new Error("No deployments/agent.json — run `npm run deploy` first.");
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function provider(d) {
  // cacheTimeout -1: never reuse a cached nonce for back-to-back transactions.
  return new ethers.JsonRpcProvider(d.rpc, undefined, { cacheTimeout: -1 });
}

function contractFor(signerOrProvider, d) {
  return new ethers.Contract(d.wallet, ABI, signerOrProvider);
}

// Turn an ethers revert into the human reason string our contract emits.
function reasonOf(err) {
  return (
    err?.revert?.args?.[0] ||
    err?.shortMessage ||
    err?.reason ||
    err?.info?.error?.message ||
    err?.message ||
    String(err)
  );
}

module.exports = { ABI, loadDeployment, provider, contractFor, reasonOf, ethers };
