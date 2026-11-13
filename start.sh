#!/bin/sh
# Container entrypoint for the hosted demo. The web server starts FIRST so the
# platform's health check (/health or /healthz) passes within seconds; then the
# private chain starts, the wallet is deployed and the data API comes up. The
# dashboard shows "waiting for the chain" until then and reconnects by itself.
# The chain and data API listen on 127.0.0.1 only; just the web server is public.
cd /app

echo "Starting the dashboard server on port ${PORT:-8080}..."
node web/server.js &
WEB=$!

echo "Starting the local Hardhat practice chain (127.0.0.1:8545, fake ETH)..."
npx hardhat node --hostname 127.0.0.1 --port 8545 > /tmp/chain.log 2>&1 &

i=0
until node -e "fetch('http://127.0.0.1:8545',{method:'POST',headers:{'content-type':'application/json'},body:'{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_blockNumber\",\"params\":[]}'}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; do
  i=$((i + 1))
  if [ "$i" -gt 120 ]; then echo "Chain did not start:"; tail -20 /tmp/chain.log; exit 1; fi
  sleep 1
done

echo "Deploying PolicyWallet..."
npm run deploy --silent || { echo "Deploy failed"; exit 1; }

echo "Starting the mock data API (127.0.0.1:4021)..."
node agent/data-api.js &

echo "Leashed Agent is ready."
# Keep the container alive as long as the web server runs.
wait $WEB
