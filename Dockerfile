# Leashed Agent hosted demo: one container runs the private Hardhat practice chain,
# deploys PolicyWallet, and serves the password-protected dashboard on $PORT.
FROM node:22-bookworm-slim

ENV HARDHAT_DISABLE_TELEMETRY_PROMPT=true \
    PORT=8080

WORKDIR /app
RUN chown node:node /app
USER node

# Dependencies first (cached between builds)
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY --chown=node:node web/package.json web/package-lock.json web/
RUN npm --prefix web ci --no-audit --no-fund

# Source, then compile the contract and build the dashboard at build time
COPY --chown=node:node . .
RUN npx hardhat compile && npm --prefix web run build

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["sh", "/app/start.sh"]
