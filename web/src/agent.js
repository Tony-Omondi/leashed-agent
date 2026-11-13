// The browser twin of agent/agent.js. Same deliberately naive "fake LLM": it
// obeys ANY instruction, including malicious ones. The point of the demo is that
// the CONTRACT, not the model, decides what actually happens.
import { ethers, reasonOf } from "./chain.js";

// The contract's require() checks, in the exact order PolicyWallet.sol runs them.
// `reason` is the revert string, so a revert maps to exactly one failed rule.
export const RULES = {
  pay: [
    { label: "Caller is the agent", code: "msg.sender == agent", reason: "Only the agent can do this" },
    { label: "Wallet is not paused", code: "!paused", reason: "The owner has paused the agent" },
    { label: "Payee is on the allowlist", code: "isAllowedPayee[payee]", reason: "That payee is not on the allowlist" },
    { label: "Within the solo limit", code: "amount <= coSignAbove", reason: "The owner must co-sign this payment" },
    { label: "Within the hourly budget", code: "spentInWindow + amount <= windowLimit", reason: "The spending window limit would be exceeded" },
  ],
  request: [
    { label: "Caller is the agent", code: "msg.sender == agent", reason: "Only the agent can do this" },
    { label: "Wallet is not paused", code: "!paused", reason: "The owner has paused the agent" },
    { label: "Payee is on the allowlist", code: "isAllowedPayee[payee]", reason: "That payee is not on the allowlist" },
  ],
  ownerOnly: [{ label: "Caller is the owner", code: "msg.sender == owner", reason: "Only the owner can do this" }],
  approve: [
    { label: "Caller is the owner", code: "msg.sender == owner", reason: "Only the owner can do this" },
    { label: "Wallet is not paused", code: "!paused", reason: "The owner has paused the agent" },
    { label: "Not already paid", code: "!r.done", reason: "Already paid" },
    { label: "Payee is on the allowlist", code: "isAllowedPayee[r.payee]", reason: "That payee is not on the allowlist" },
  ],
};

// Send a real transaction and turn the result into a rule-by-rule verdict.
async function submit(rules, send) {
  try {
    const tx = await send();
    const rc = await tx.wait();
    return { ok: true, hash: rc.hash, failedAt: -1 };
  } catch (err) {
    const reason = reasonOf(err);
    return { ok: false, reason, failedAt: rules.findIndex((r) => r.reason === reason) };
  }
}

// ---------- the "brain": deterministic, obeys everything ----------
export function think(text, d) {
  const addr = text.match(/0x[0-9a-fA-F]{40}/)?.[0];
  const amount = text.match(/(\d+(?:\.\d+)?)\s*eth/i)?.[1];
  const toSeller = /seller|agrovet|supplier/i.test(text);
  if (/allowlist|whitelist|add .* payee/i.test(text) && addr) return { tool: "set_payee", args: { payee: addr } };
  if (/approv|co-?sign|request/i.test(text) && amount)
    return { tool: "request_owner_approval", args: { payee: addr || d.seller, amount_eth: amount, reason: text.slice(0, 60) } };
  if ((addr || toSeller) && amount) return { tool: "pay", args: { payee: addr || d.seller, amount_eth: amount, reason: text.slice(0, 60) } };
  if (/price|market|maize|sell/i.test(text)) return { tool: "buy_data", args: { dataset: "market-prices", query: "maize" } };
  return { tool: "buy_data", args: { dataset: "weather", query: /nairobi/i.test(text) ? "Nairobi" : "Kiambu" } };
}

// ---------- tools (every money move goes through the contract) ----------
export async function act(plan, c, d) {
  const { tool, args } = plan;

  if (tool === "pay") {
    const amount = ethers.parseEther(String(args.amount_eth));
    const r = await submit(RULES.pay, () => c.agent.pay(args.payee, amount, args.reason));
    return { kind: "pay", rules: RULES.pay, payee: args.payee, amount, ...r };
  }

  if (tool === "request_owner_approval") {
    const amount = ethers.parseEther(String(args.amount_eth));
    const r = await submit(RULES.request, () => c.agent.requestPayment(args.payee, amount, args.reason));
    return { kind: "request", rules: RULES.request, payee: args.payee, amount, ...r };
  }

  if (tool === "set_payee") {
    const r = await submit(RULES.ownerOnly, () => c.agent.setPayee(args.payee, true));
    return { kind: "set_payee", rules: RULES.ownerOnly, payee: args.payee, amount: 0n, ...r };
  }

  if (tool === "buy_data") {
    const url = `/data/${args.dataset}?q=${encodeURIComponent(args.query)}`;
    let first;
    try {
      first = await fetch(url);
    } catch {
      return { kind: "buy", error: "Data API not reachable. Run `npm run data-api`." };
    }
    if (first.status !== 402) {
      return { kind: "buy", error: `Data API answered ${first.status}. Is \`npm run data-api\` running?` };
    }
    const { accepts } = await first.json();
    const amount = BigInt(accepts.amountWei);
    const r = await submit(RULES.pay, () => c.agent.pay(accepts.payTo, amount, accepts.memo));
    const out = { kind: "buy", rules: RULES.pay, payee: accepts.payTo, amount, price402: amount, ...r };
    if (!r.ok) return out;
    const second = await fetch(url, { headers: { "x-payment": r.hash } });
    return { ...out, data: (await second.json()).data };
  }

  return { kind: "unknown", error: `Unknown tool ${tool}` };
}

// A stranger with their own key calls pay() directly, skipping the agent.
export async function strangerPays(c, d) {
  const amount = ethers.parseEther("0.01");
  const r = await submit(RULES.pay, () => c.attacker.pay(d.attacker, amount, "theft"));
  return { kind: "pay", rules: RULES.pay, payee: d.attacker, amount, ...r };
}

// Owner actions (the dashboard plays the owner's role, with the owner's key).
export async function ownerAct(c, name, ...args) {
  const rules = name === "approve" ? RULES.approve : RULES.ownerOnly;
  return { kind: name, rules, ...(await submit(rules, () => c.owner[name](...args))) };
}
