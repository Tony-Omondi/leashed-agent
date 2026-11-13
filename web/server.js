// Production server for a hosted demo (e.g. PrimeCloud). One public port serves:
//   GET  /healthz          no password: is the chain up and the wallet deployed?
//   *    everything else   HTTP Basic auth (username "judge" + the team's demo password)
//   GET  /                 the built dashboard (web/dist)
//   POST /rpc              FILTERED proxy to the private Hardhat node on 127.0.0.1
//   GET  /data/*           proxy to the mock data API on 127.0.0.1:4021
//   /api/deployment, /api/llm, /api/reset   (shared with the dev server, api.js)
// The Hardhat node itself is never exposed: it listens on 127.0.0.1 only, and the
// proxy refuses node-signed transactions (eth_sendTransaction) and admin calls.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { CHAIN_RPC, DEPLOYMENT, sendJson, readBody, chainCall, deploymentHandler, makeLlmHandler, resetHandler } from "./api.js";

const PORT = Number(process.env.PORT || 8080);

// Login for the hosted demo. Only a salted scrypt HASH of the password is in the
// repo, never the password itself, so reading this file doesn't reveal it.
const USER = "judge";
const PASSWORD_SALT = "af8bb3a2b410f6b156cb197fa25664ea";
const PASSWORD_HASH = Buffer.from("bbb2b06bca45f7d80d73d445f4d37423582ace1d868657532852df572e5536c7", "hex");
const SCRYPT = { N: 16384, r: 8, p: 1 };

const DIST = fileURLToPath(new URL("./dist/", import.meta.url));
const llm = makeLlmHandler(process.env);

// JSON-RPC methods the dashboard needs. Transactions must arrive already signed
// (eth_sendRawTransaction), so nobody can spend from the node's unlocked accounts.
const ALLOWED_RPC = new Set([
  "eth_chainId", "net_version", "eth_blockNumber", "eth_getBalance", "eth_getCode", "eth_call",
  "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
  "eth_getTransactionCount", "eth_sendRawTransaction", "eth_getTransactionByHash",
  "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs",
  "evm_increaseTime", "evm_mine", // "Skip 1 hour" (local practice chain only)
]);

// Password check: scrypt (slow on purpose) + constant-time compare. A header that
// already passed is remembered, so page assets don't each pay the scrypt cost.
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
const accepted = new Set();
function authorized(req) {
  const header = req.headers.authorization || "";
  const seen = digest(header).toString("hex");
  if (accepted.has(seen)) return true;
  const [type, b64] = header.split(" ");
  if (type !== "Basic" || !b64) return false;
  const decoded = Buffer.from(b64, "base64").toString("utf8");
  const i = decoded.indexOf(":");
  if (i < 0 || decoded.length > 256) return false;
  const userOk = crypto.timingSafeEqual(digest(decoded.slice(0, i)), digest(USER));
  const hash = crypto.scryptSync(decoded.slice(i + 1), PASSWORD_SALT, 32, SCRYPT);
  const passOk = crypto.timingSafeEqual(hash, PASSWORD_HASH);
  if (userOk && passOk) accepted.add(seen);
  return userOk && passOk;
}

// Tiny per-route rate limit, so a leaked link can't burn the LLM quota.
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

async function rpcProxy(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  let msg;
  try { msg = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: "Bad JSON" }); }
  const calls = Array.isArray(msg) ? msg : [msg];
  const blocked = calls.find((c) => !ALLOWED_RPC.has(c?.method));
  if (blocked) {
    console.warn(`rpc: refused ${blocked?.method}`);
    return sendJson(res, 200, { jsonrpc: "2.0", id: blocked?.id ?? null, error: { code: -32601, message: `${blocked?.method} is not allowed on the hosted demo` } });
  }
  const r = await fetch(CHAIN_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) });
  sendJson(res, r.status, await r.text());
}

async function dataProxy(req, res) {
  const target = `http://127.0.0.1:4021${req.url.replace(/^\/data/, "")}`;
  const headers = {};
  for (const h of ["x-payment", "x-payment-signature"]) if (req.headers[h]) headers[h] = req.headers[h];
  try {
    const r = await fetch(target, { headers });
    sendJson(res, r.status, await r.text());
  } catch {
    sendJson(res, 502, { error: "Data API not reachable" });
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".json": "application/json", ".ico": "image/x-icon" };
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST)) { res.statusCode = 403; return res.end("Forbidden"); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
  if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader("cache-control", "public, max-age=31536000, immutable");
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("referrer-policy", "no-referrer");
  const url = req.url || "/";
  try {
    if (url === "/healthz") {
      const block = await chainCall("eth_blockNumber").catch(() => null);
      const ok = Boolean(block) && fs.existsSync(DEPLOYMENT);
      return sendJson(res, ok ? 200 : 503, { status: ok ? "ok" : "starting", block: block ? parseInt(block, 16) : null });
    }
    if (!authorized(req)) {
      res.statusCode = 401;
      res.setHeader("www-authenticate", 'Basic realm="Leashed Agent demo", charset="UTF-8"');
      return res.end("Password required");
    }
    if (url === "/rpc" || url.startsWith("/rpc?")) return await rpcProxy(req, res);
    if (url.startsWith("/data/")) return await dataProxy(req, res);
    if (url.startsWith("/api/deployment")) return deploymentHandler(req, res);
    if (url.startsWith("/api/llm")) {
      if (req.method === "POST" && limited("llm", 40, 60_000)) return sendJson(res, 429, { error: "Too many model calls; wait a minute" });
      return await llm(req, res);
    }
    if (url.startsWith("/api/reset")) {
      if (limited("reset", 6, 60_000)) return sendJson(res, 429, { error: "Too many resets; wait a minute" });
      return await resetHandler(req, res);
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "Method not allowed" });
    return serveStatic(req, res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: "Server error" });
  }
});

const brain = process.env.LLM_API_KEY || process.env.GROQ_API_KEY ? "LLM key found" : "no LLM key: Fake LLM only";
server.listen(PORT, "0.0.0.0", () => console.log(`Leashed Agent demo on :${PORT} (login user "${USER}"; ${brain})`));
