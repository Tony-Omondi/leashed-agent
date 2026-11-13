import { defineConfig } from "vite";
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

export default defineConfig({
  plugins: [react(), tailwindcss(), deploymentEndpoint()],
  server: {
    proxy: {
      // Same-origin proxies: no CORS changes needed on the chain or data API.
      "/rpc": { target: "http://127.0.0.1:8545", changeOrigin: true, rewrite: () => "/" },
      "/data": { target: "http://127.0.0.1:4021", changeOrigin: true, rewrite: (p) => p.replace(/^\/data/, "") },
    },
  },
});
