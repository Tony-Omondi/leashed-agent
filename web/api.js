// Server-side routes shared by the Vite dev server (vite.config.js) and the
// production server (server.js). They run in Node, never in the browser, so the
// LLM key and the chain's admin calls stay on the server.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";

const execFileP = promisify(execFile);
const llm = createRequire(import.meta.url)("../agent/llm.js");

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const DEPLOYMENT = fileURLToPath(new URL("../deployments/agent.json", import.meta.url));
export const CHAIN_RPC = "http://127.0.0.1:8545";

export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

export async function readBody(req, limit = 512 * 1024) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new Error("Request body too large");
  }
  return raw;
}

export async function chainCall(method, params = []) {
  const r = await fetch(CHAIN_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  return (await r.json()).result;
}

// deployments/agent.json is (re)written by `npm run deploy`; serve it fresh.
export function deploymentHandler(_req, res) {
  if (!fs.existsSync(DEPLOYMENT)) return sendJson(res, 503, { error: "No deployment yet. Run `npm run deploy`." });
  sendJson(res, 200, fs.readFileSync(DEPLOYMENT, "utf8"));
}

// LLM proxy: the same brain order as the CLI (agent/llm.js). The page falls back
// to the fake brain if every real brain fails (rate limit, outage, no key).
export function makeLlmHandler(env) {
  const first = llm.configured(env);
  return async (req, res) => {
    if (req.method === "GET") return sendJson(res, 200, { configured: Boolean(first), model: first?.label ?? null });
    if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
    if (!first) return sendJson(res, 503, { error: "No LLM key configured" });
    let body;
    try { body = JSON.parse((await readBody(req)) || "{}"); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    try {
      const { label, message } = await llm.chat({ messages: body.messages, tools: body.tools }, env);
      sendJson(res, 200, { model: label, message });
    } catch (e) {
      sendJson(res, 502, { error: e.message });
    }
  };
}

// "Reset demo": wipe the local practice chain and re-run the real deploy script,
// so every judge starts from a freshly deployed, funded wallet. Only ever talks
// to the Hardhat node on 127.0.0.1.
export async function resetHandler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed" });
  try {
    if (!(await chainCall("hardhat_reset"))) throw new Error("hardhat_reset failed");
    await execFileP("npm", ["run", "deploy", "--silent"], { cwd: ROOT, timeout: 90000 });
    sendJson(res, 200, fs.readFileSync(DEPLOYMENT, "utf8"));
  } catch (e) {
    sendJson(res, 500, { error: e.message });
  }
}
