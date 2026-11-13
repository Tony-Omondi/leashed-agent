#!/bin/sh
# Container entrypoint for the hosted demo: private chain → deploy → data API → web.
# The chain and data API listen on 127.0.0.1 only; just the web server is public.
set -e
cd /app

echo "Starting the local Hardhat practice chain (127.0.0.1:8545, fake ETH)..."
npx hardhat node --hostname 127.0.0.1 --port 8545 > /tmp/chain.log 2>&1 &

i=0
until node -e "fetch('http://127.0.0.1:8545',{method:'POST',headers:{'content-type':'application/json'},body:'{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_blockNumber\",\"params\":[]}'}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then echo "Chain did not start:"; tail -20 /tmp/chain.log; exit 1; fi
  sleep 1
done

echo "Deploying PolicyWallet..."
npm run deploy --silent

echo "Starting the mock data API (127.0.0.1:4021)..."
node agent/data-api.js &

echo "Starting the dashboard server on port ${PORT:-8080}..."
exec node web/server.js
