// The leashed AI agent. It plans with an LLM and acts through the PolicyWallet.
// Three brains via env: LLM_FAKE=1 (rule-based, no key) | Ollama | hosted key.
// KEY POINT: the agent NEVER holds the owner's key, and the CONTRACT enforces
// the policy — so even a tricked agent can't move funds outside the rules.
const { loadDeployment, provider, contractFor, reasonOf, ethers } = require("./shared");

const FAKE = process.env.LLM_FAKE === "1";
const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:11434/v1";
const LLM_MODEL = process.env.LLM_MODEL || "qwen2.5:3b";
const LLM_API_KEY = process.env.LLM_API_KEY || "";
const DATA_API = process.env.DATA_API_URL || "http://localhost:4021";
const MAX_STEPS = 6;

const d = loadDeployment();
const p = provider(d);
const agentSigner = new ethers.Wallet(d.agentKey, p); // agent key ONLY
const wallet = contractFor(agentSigner, d);

const SYSTEM_PROMPT =
  "You are a purchasing agent for Wanjiru, a smallholder farmer in Kiambu, Kenya. " +
  "You can buy weather forecasts and crop market prices and pay her approved suppliers " +
  "from her policy wallet. Amounts are in ETH on a practice chain. Keep answers short.";

const TOOLS = [
  { type: "function", function: { name: "check_wallet", description: "Show wallet balance and spending rules.", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "buy_data", description: "Buy weather or market-prices data (pays automatically).", parameters: { type: "object", properties: { dataset: { type: "string", enum: ["weather", "market-prices"] }, query: { type: "string" } }, required: ["dataset", "query"] } } },
  { type: "function", function: { name: "pay", description: "Pay an address from the wallet.", parameters: { type: "object", properties: { payee: { type: "string" }, amount_eth: { type: "string" }, reason: { type: "string" } }, required: ["payee", "amount_eth", "reason"] } } },
  { type: "function", function: { name: "request_owner_approval", description: "Ask the owner to co-sign a payment too large to make alone.", parameters: { type: "object", properties: { payee: { type: "string" }, amount_eth: { type: "string" }, reason: { type: "string" } }, required: ["payee", "amount_eth", "reason"] } } },
];

// ---------- the four tools (all go through the contract) ----------
async function checkWallet() {
  const [bal, spent, limit, coSign, paused] = await Promise.all([
    p.getBalance(d.wallet), wallet.spentInWindow(), wallet.windowLimit(), wallet.coSignAbove(), wallet.paused(),
  ]);
  return {
    balanceEth: ethers.formatEther(bal), spentThisWindowEth: ethers.formatEther(spent),
    windowLimitEth: ethers.formatEther(limit), coSignAboveEth: ethers.formatEther(coSign), paused,
  };
}

async function pay({ payee, amount_eth, reason }) {
  const tx = await wallet.pay(payee, ethers.parseEther(String(amount_eth)), String(reason || ""));
  const rcpt = await tx.wait();
  return { ok: true, txHash: rcpt.hash };
}

async function requestApproval({ payee, amount_eth, reason }) {
  const tx = await wallet.requestPayment(payee, ethers.parseEther(String(amount_eth)), String(reason || ""));
  await tx.wait();
  const id = (await wallet.requestCount()) - 1n;
  return { ok: true, requestId: id.toString(), note: "Waiting for the owner to approve" };
}

async function buyData({ dataset, query }) {
  const url = `${DATA_API}/${dataset}?q=${encodeURIComponent(query)}`;
  const first = await fetch(url);
  if (first.status !== 402) return first.json();
  const { accepts } = await first.json();
  const tx = await wallet.pay(accepts.payTo, BigInt(accepts.amountWei), accepts.memo);
  const rcpt = await tx.wait();
  const second = await fetch(url, { headers: { "x-payment": rcpt.hash } });
  return second.json();
}

async function runTool(name, args) {
  try {
    if (name === "check_wallet") return await checkWallet();
    if (name === "buy_data") return await buyData(args);
    if (name === "pay") return await pay(args);
    if (name === "request_owner_approval") return await requestApproval(args);
    return { error: `Unknown tool ${name}` };
  } catch (err) {
    return { error: reasonOf(err) }; // contract reverts surface here as plain text
  }
}

// ---------- the brain ----------
function toolCall(name, args) {
  return { role: "assistant", content: null, tool_calls: [{ id: `c_${Date.now()}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] };
}

// Deterministic fallback. It intentionally does NOT resist malicious prompts —
// that's the point: the CONTRACT protects the funds, not the model.
function fakeLlm(messages) {
  const last = messages.at(-1);
  if (last.role === "tool") {
    const result = JSON.parse(last.content);
    if (result.error) return { role: "assistant", content: `Blocked by the wallet: ${result.error}. No funds moved.` };
    return { role: "assistant", content: `Done. ${last.content}` };
  }
  const text = last.content;
  const payee = text.match(/0x[0-9a-fA-F]{40}/)?.[0];
  const amount = text.match(/(\d+(?:\.\d+)?)\s*eth/i)?.[1];
  if (payee && amount) return toolCall("pay", { payee, amount_eth: amount, reason: text.slice(0, 60) });
  if (/price|market|sell/i.test(text)) return toolCall("buy_data", { dataset: "market-prices", query: "maize" });
  if (/wallet|balance|limit/i.test(text)) return toolCall("check_wallet", {});
  return toolCall("buy_data", { dataset: "weather", query: "Kiambu" });
}

async function callLlm(messages) {
  if (FAKE) return fakeLlm(messages);
  const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(LLM_API_KEY ? { authorization: `Bearer ${LLM_API_KEY}` } : {}) },
    body: JSON.stringify({ model: LLM_MODEL, messages, tools: TOOLS, tool_choice: "auto" }),
  });
  if (!res.ok) throw new Error(`LLM request failed (${res.status}): ${await res.text()}`);
  const m = (await res.json()).choices[0].message;
  return { role: m.role, content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) };
}

async function main() {
  const request = process.argv.slice(2).join(" ").trim();
  if (!request) return console.log('Usage: npm run agent -- "What will the weather be in Kiambu this week?"');
  console.log(`Agent ${agentSigner.address} using ${FAKE ? "the fake LLM" : `${LLM_MODEL} @ ${LLM_BASE_URL}`}`);

  const messages = [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: request }];
  for (let step = 0; step < MAX_STEPS; step++) {
    const reply = await callLlm(messages);
    messages.push(reply);
    if (!reply.tool_calls) return console.log(`\nAgent: ${reply.content || "(no answer)"}`);
    for (const call of reply.tool_calls) {
      const args = JSON.parse(call.function.arguments || "{}");
      console.log(`\n> ${call.function.name} ${JSON.stringify(args)}`);
      const result = await runTool(call.function.name, args);
      console.log(`< ${JSON.stringify(result)}`);
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  console.log(`\nAgent stopped after ${MAX_STEPS} steps.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
