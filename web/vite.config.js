import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// deployments/agent.json is (re)written by `npm run deploy`. Serve it fresh on
// every request so the dashboard always talks to the latest deployment.
const DEPLOYMENT = fileURLToPath(new URL("../deployments/agent.json", import.meta.url));

function deploymentEndpoint() {
  return {
    name: "leashed-deployment",
    configureServer(server) {
      server.middlewares.use("/api/deployment", (_req, res) => {
        res.setHeader("content-type", "application/json");
        res.setHeader("cache-control", "no-store");
        if (!fs.existsSync(DEPLOYMENT)) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "No deployment yet. Run `npm run deploy`." }));
          return;
        }
        res.end(fs.readFileSync(DEPLOYMENT, "utf8"));
      });
    },
  };
}

// Server-side LLM proxy. The API key is read from ../.env by Node and NEVER sent
// to the browser. Tries the main model, then the fallback model; the page falls
// back to the fake brain if both fail (rate limit, outage, no key).
function llmEndpoint() {
  const env = loadEnv("", fileURLToPath(new URL("..", import.meta.url)), "LLM_");
  const models = [env.LLM_MODEL, env.LLM_FALLBACK_MODEL].filter(Boolean);
  const configured = Boolean(env.LLM_BASE_URL && env.LLM_API_KEY && models.length);
  return {
    name: "leashed-llm",
    configureServer(server) {
      server.middlewares.use("/api/llm", async (req, res) => {
        res.setHeader("content-type", "application/json");
        const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
        if (req.method === "GET") return send(200, { configured, model: models[0] || null });
        if (!configured) return send(503, { error: "No LLM configured in .env" });
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const { messages, tools } = JSON.parse(raw || "{}");
        const errors = [];
        for (const model of models) {
          try {
            const r = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` },
              body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
              signal: AbortSignal.timeout(25000),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const message = (await r.json()).choices[0].message;
            return send(200, { model, message });
          } catch (e) {
            errors.push(`${model}: ${e.message}`);
          }
        }
        send(502, { error: errors.join("; ") });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), deploymentEndpoint(), llmEndpoint()],
  server: {
    proxy: {
      // Same-origin proxies: no CORS changes needed on the chain or data API.
      "/rpc": { target: "http://127.0.0.1:8545", changeOrigin: true, rewrite: () => "/" },
      "/data": { target: "http://127.0.0.1:4021", changeOrigin: true, rewrite: (p) => p.replace(/^\/data/, "") },
    },
  },
});
