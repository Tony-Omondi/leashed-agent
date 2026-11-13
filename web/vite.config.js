import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { ROOT, deploymentHandler, makeLlmHandler, resetHandler } from "./api.js";

// Dev server: the same server-side routes as production (web/server.js), minus
// the password, since it only listens on localhost. LLM_* settings come from ../.env.
function leashedApi() {
  const env = loadEnv("", ROOT, "LLM_");
  return {
    name: "leashed-api",
    configureServer(server) {
      server.middlewares.use("/api/deployment", deploymentHandler);
      server.middlewares.use("/api/llm", makeLlmHandler(env));
      server.middlewares.use("/api/reset", resetHandler);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), leashedApi()],
  server: {
    proxy: {
      // Same-origin proxies: no CORS changes needed on the chain or data API.
      "/rpc": { target: "http://127.0.0.1:8545", changeOrigin: true, rewrite: () => "/" },
      "/data": { target: "http://127.0.0.1:4021", changeOrigin: true, rewrite: (p) => p.replace(/^\/data/, "") },
    },
  },
});
