// Talks to the real PolicyWallet on the local Hardhat chain (via the Vite /rpc proxy).
// Nothing here re-implements the policy: every verdict comes from the contract.
import { ethers } from "ethers";

export const ABI = [
  "function pay(address payee, uint256 amount, string reason)",
  "function requestPayment(address payee, uint256 amount, string reason) returns (uint256)",
  "function approve(uint256 id)",
  "function setPayee(address payee, bool allowed)",
  "function setAgent(address newAgent)",
  "function setPaused(bool paused)",
  "function isAllowedPayee(address) view returns (bool)",
  "function spentInWindow() view returns (uint256)",
  "function windowLimit() view returns (uint256)",
  "function windowSeconds() view returns (uint256)",
  "function windowStart() view returns (uint256)",
  "function coSignAbove() view returns (uint256)",
  "function paused() view returns (bool)",
  "function agent() view returns (address)",
  "function requestCount() view returns (uint256)",
  "function requests(uint256) view returns (address payee, uint256 amount, string reason, bool done)",
];

export async function loadDeployment() {
  const res = await fetch("/api/deployment", { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "No deployment");
  return body;
}

export function connect(d) {
  const provider = new ethers.JsonRpcProvider(`${location.origin}/rpc`, 31337, {
    staticNetwork: true,
    batchMaxCount: 1,
    // ethers caches identical RPC reads for 250ms by default; back-to-back
    // transactions would then reuse a stale nonce. Always read fresh.
    cacheTimeout: -1,
  });
  const read = new ethers.Contract(d.wallet, ABI, provider);
  const as = (key) => read.connect(new ethers.Wallet(key, provider));
  return {
    provider,
    read,
    agent: as(d.agentKey),
    owner: as(d.ownerKey),
    attacker: as(d.attackerKey),
  };
}

export async function readState(c, d) {
  const [balance, spent, limit, coSign, paused, agent, windowStart, windowSeconds, count, block, sellerOk, attackerOk] =
    await Promise.all([
      c.provider.getBalance(d.wallet),
      c.read.spentInWindow(),
      c.read.windowLimit(),
      c.read.coSignAbove(),
      c.read.paused(),
      c.read.agent(),
      c.read.windowStart(),
      c.read.windowSeconds(),
      c.read.requestCount(),
      c.provider.getBlock("latest"),
      c.read.isAllowedPayee(d.seller),
      c.read.isAllowedPayee(d.attacker),
    ]);
  const requests = [];
  for (let i = 0n; i < count; i++) {
    const r = await c.read.requests(i);
    requests.push({ id: Number(i), payee: r.payee, amount: r.amount, reason: r.reason, done: r.done });
  }
  const windowEnds = Number(windowStart + windowSeconds);
  return {
    balance, spent, limit, coSign, paused,
    agentActive: agent.toLowerCase() === d.agent.toLowerCase(),
    blockNumber: block.number,
    secondsLeft: Math.max(0, windowEnds - block.timestamp),
    allow: { seller: sellerOk, attacker: attackerOk },
    requests,
  };
}

// Turn an ethers revert into the reason string the contract emitted.
export function reasonOf(err) {
  return (
    err?.revert?.args?.[0] ||
    err?.reason ||
    err?.shortMessage ||
    err?.info?.error?.message ||
    err?.message ||
    String(err)
  );
}

export async function timeTravel(c, seconds) {
  await c.provider.send("evm_increaseTime", [seconds]);
  await c.provider.send("evm_mine", []);
}

// Wipe the local chain and redeploy (server-side, see vite.config.js). Returns the
// new deployment. More reliable than evm_snapshot/evm_revert, whose snapshot IDs
// Hardhat can invalidate internally.
export async function resetChain() {
  const res = await fetch("/api/reset", { method: "POST" });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Reset failed");
  return body;
}

export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
// At least 3 decimals, more only when needed (0.001, 0.0005), no trailing noise.
export const eth = (wei) => {
  const n = Number(ethers.formatEther(wei ?? 0n));
  const [i, f = ""] = String(Number(n.toFixed(6))).split(".");
  return `${i}.${f.padEnd(3, "0")}`;
};
export { ethers };
