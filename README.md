# Leashed Agent: a policy-controlled wallet for a farmer's AI purchasing agent

**Zetech Forge Hackathon · Web3 & Blockchain track · Challenge C: Leashed Agent (Advanced)**

**Team Shamba Shield.** *"Shamba"* is Swahili for farm; the contract is the shield.
Repository: [Tony-Omondi/leashed-agent](https://github.com/Tony-Omondi/leashed-agent)

> **In one line:** the model proposes payments, and the wallet decides. In testing, a real
> Gemini model fell for a "supplier changed its wallet address" scam and tried to pay
> the attacker twice. `PolicyWallet.sol` reverted both, and no funds moved.

| | |
|---|---|
| Team members | **Tony Omondi**: contracts and tests · **Victor Muthoni**: dashboard and demo |
| Alumni / Finalist Collaborator | None |
| Backup demo video (2–3 min) | _TODO: link_ |

---

## 1. Starting point and our contribution

The track rules require teams to build on the supplied baseline and to identify their
own contribution separately. This is that summary.

### Supplied by the official starter ([zetech-forge/web3_starter-kit](https://github.com/zetech-forge/web3_starter-kit))

- **`contracts/PolicyWallet.sol`**: the wallet logic is **the kit's contract, unchanged**.
  We only added explanatory comments. We did not alter any policy semantics: the
  allowlist, the 0.02 ETH approval threshold, the 0.05 ETH per-hour autonomous budget,
  `requestPayment()`/`approve()`, pause, revocation and single settlement.
- **The design and default settings** of the deploy script, agent loop, owner CLI and
  mock x402-style data API: account 0 is owner, 1 is agent and 2 is the seller; the
  wallet starts with 1 ETH; the API runs on port 4021; the fake fallback brain.

### Alternative tooling

The kit uses Hardhat 3, viem, TypeScript and Solidity tests. This repository runs the
same contract and flows on **Hardhat 2.29.2, ethers v6, CommonJS and JavaScript
(Mocha/Chai) tests** (exact versions are in §5). The track rules allow alternative
EVM-compatible tooling when the same behaviour, acceptance tests and sandbox
restrictions are met. _We are confirming this with the Technical Lead._

### Our team's contribution

1. **Use case:** a purchasing agent for Wanjiru, a smallholder maize farmer in Kiambu.
   It buys mock weather and crop-price data and requests owner approval for bulk
   fertiliser (SDG 2).
2. **Acceptance-matrix test suite:** 25 tests (§6), including exact boundaries (exactly
   0.02 ETH, the exact remaining budget, one wei over each, 3599 s versus 3600 s), a
   rollback on failed transfer, pause/revocation semantics and attempted policy
   changes by the agent, a stranger and the recipient.
3. **Payment proof check in the data API:** before serving data it checks, on-chain, that
   - the transaction succeeded,
   - it went through our PolicyWallet,
   - it emitted `Paid(seller, ≥ price, memo)`,
   - its sender signed the tx hash,
   - it is recent and has not been used before.

   `npm run check:data-api` exercises seven forged or replayed proofs (§6).
4. **Real LLM brain with fallback:** Google Gemini through its OpenAI-compatible API,
   falling back from `LLM_MODEL` to `LLM_FALLBACK_MODEL` to the fake brain on a rate
   limit or outage. The key lives only in a git-ignored `.env`.
5. **Realistic injection attack:** a "supplier changed its wallet address" message (a
   common real-world fraud) in place of a crude "ignore your instructions" prompt,
   which a real model often refuses outright.
6. **Read-only audit and demo dashboard (React + Tailwind, `web/`), an optional
   extension.** Every button sends a real transaction. Each attempt shows the
   contract's `require` checks in order (passed, reverted with the exact reason, or
   not reached), plus owner controls and a one-click reset between judges. The reset
   wipes the local chain (`hardhat_reset`) and re-runs the real deploy script. The data
   API and CLI re-read `deployments/agent.json`, so they follow without a restart.
7. **One-command demo** (`npm run demo`), a clearer fake-brain message when the wallet
   blocks a payment, and a looser place/crop match in the mock API.

Owner-approved spending semantics are **unchanged**. We made no change to the baseline
behaviour.

---

## 2. Problem, SDG and why a blockchain

**Beneficiary:** a smallholder farmer who delegates small, routine purchases (weather
forecasts, market prices, inputs) to an AI assistant.

**SDG 2, Zero Hunger.** Timely planting and spraying decisions and fair crop prices
protect yields and income. An assistant saves the farmer time, but *permission to act
must not become permission to spend without limits*.

**Why a blockchain helps:** the spending rules are enforced by a contract that neither
the AI nor its key can change. They also produce a shared, tamper-evident record
(`Paid` events with reasons, and pending requests) that the farmer, a co-operative or
an auditor can check.

**What the chain cannot verify (trust limits):**

- The owner is trusted: they set the allowlist and approve large payments.
- A payment *reason* is a log, **not proof the statement is true**.
- The chain cannot judge whether an allowlisted seller's data is accurate. Our data is
  **mock**, not real forecasts or prices.
- The public Hardhat mnemonic is **not** secret. These keys must never secure real funds.

---

## 3. Roles and policy

| Role | Account (local) | Can do | Cannot do |
|---|---|---|---|
| **Owner** (trusted) | #0 `0xf39F…2266` | Fund the wallet, allow or block payees, set or revoke the agent, pause and unpause, `approve()` requests | None of the agent's limits apply to `approve()` |
| **AI agent** | #1 `0x7099…79C8` | `pay()` within policy, `requestPayment()` | Change any policy, approve anything, pay non-allowlisted addresses |
| **Approved recipient** (mock data seller) | #2 `0x3C44…93BC` | Receive payments | Change policy, pay, request or approve |
| Attacker / stranger | #3 `0x90F7…b906` | Nothing | Everything above |

The agent never holds the owner's key. `agent/agent.js` and the dashboard's agent sign
only with key #1.

**Policy (defaults, as in the kit):** 1 ETH starting balance · approval threshold
**0.02 ETH per payment** · autonomous budget **0.05 ETH per one-hour window** · initial
allowlist: the data seller.

- **`pay()` (autonomous)** requires all of the following:
  - the caller is the agent;
  - the wallet is not paused;
  - the payee is allowlisted;
  - the amount is at most 0.02 ETH;
  - autonomous spending in the window stays at or below 0.05 ETH.

  Exactly 0.02 ETH, or exactly the remaining budget, is allowed; one wei more is rejected.
- **Window:** it starts at deployment and resets on the next *successful* autonomous
  payment once at least 3,600 s have passed since `windowStart`. It is **not** a sliding
  window and is not aligned to clock hours. If a payment fails, its reset is rolled back.
- **Above 0.02 ETH:** the agent calls `requestPayment()`, which moves no funds. The owner
  calls `approve(id)` as a separate on-chain transaction. Approval rechecks the
  allowlist, requires the wallet to be unpaused, rejects an already settled request and
  needs enough balance.
- **Owner-approved payments are outside the autonomous budget.** An approved 0.3 ETH
  payment succeeds and does not increase `spentInWindow`. This is deliberate baseline
  behaviour: the trusted owner makes that decision explicitly. It is an on-chain
  approval, not an off-chain co-signature. The legacy names `coSignAbove` and
  `coSigned` refer to this flow.
- **Pause** blocks payments, requests **and** approvals.
- **Revocation** (`setAgent(0)`) blocks new agent payments and requests but does not
  cancel pending requests; the owner may still approve them. Unpausing does not restore
  a revoked agent.

**Data structures (DSA):**

- `mapping(address ⇒ bool) isAllowedPayee` gives an O(1) allowlist check.
- `windowStart` and `spentInWindow` give O(1) budget accounting with no history scan.
- `Request[] requests` is an append-only, O(1)-indexed approval queue whose index is the
  request ID.

No agent-callable path loops over storage, so gas use does not grow as the lists grow.

---

## 4. Purchasing flow (x402-style, mock)

1. The agent calls `GET /weather?q=Kiambu` and receives **HTTP 402** with
   `{ payTo: seller, amountWei: 0.001 ETH, memo: "data:/weather" }`.
2. The agent calls `PolicyWallet.pay(seller, 0.001 ETH, "data:/weather")`. The contract
   checks the policy and emits `Paid` with the reason.
3. The agent signs the tx hash with **its own** key and retries with the `X-PAYMENT` and
   `X-PAYMENT-SIGNATURE` headers.
4. The API verifies the payment on-chain (§1, item 3) and returns the mock data.

This **imitates** x402. It is not a production x402 implementation, and we do not claim
interoperability or real-world data accuracy. The payer signature is separate from the
wallet's on-chain owner approval.

---

## 5. Setup

**Versions:**

- Node.js 22.13+ (tested on 26.13.0) · npm 11
- Hardhat 2.29.2 with `@nomicfoundation/hardhat-toolbox` 5
- Solidity 0.8.24 · ethers 6
- Dashboard: Vite 8 · React 19 · Tailwind 4

Lockfiles are committed.

```bash
npm ci
npm run build          # compile
npm test               # 25 wallet tests (§6)
npm run web:install    # once, for the dashboard
```

### Option A: one command plus the dashboard

```bash
npm run demo           # chain + deploy + data API + dashboard
```

Then open **http://localhost:5173**.

### Option B: four terminals (as in the challenge brief)

```bash
npm run chain                                   # 1: local practice chain (keep running)
npm run deploy:agent                            # 2: deploy + fund wallet, allowlist seller → deployments/agent.json
npm run data-api                                # 3: mock paid API on :4021 (restart after any redeploy)
LLM_FAKE=1 npm run agent -- "What will the weather be in Kiambu this week?"   # 4
```

Windows PowerShell: `$env:LLM_FAKE = "1"` on its own line, then `npm run agent -- "…"`.

**Owner commands:**

```bash
npm run owner -- pause
npm run owner -- unpause
npm run owner -- revoke
npm run owner -- approve 0
npm run owner -- allow PAYEE_ADDRESS
npm run owner -- block PAYEE_ADDRESS
npm run owner -- agent NEW_AGENT_ADDRESS
```

### Model configuration

| Brain | How |
|---|---|
| Fake (deterministic, no key) | `LLM_FAKE=1`, or the dashboard's **Fake LLM** switch. It obeys any instruction on purpose; it is a stand-in, not a safe assistant. |
| Gemini (free tier) | Create `.env` (git-ignored) as shown below. |
| Ollama (local) | `ollama pull qwen2.5:3b`, then run with no `.env` and no `LLM_FAKE`. |

```bash
LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL=gemini-3.5-flash
LLM_FALLBACK_MODEL=gemini-3.1-flash-lite
LLM_API_KEY=your_key_here
```

The dashboard calls the model through a server-side proxy in `web/vite.config.js`, so
the key never reaches the browser. Each verdict card names the model that actually
answered.

---

## 6. Acceptance matrix → evidence

Run `npm test` for the contract tests (precise boundaries) and `npm run check:data-api`
for the payment-proof attacks. The agent runs and the dashboard provide end-to-end
evidence.

| Required test (Challenge C) | Evidence |
|---|---|
| Allowed small payment emits `Paid` (amount, recipient, reason) | *agent pays an allowlisted payee within the limit*; *threshold: exactly 0.02 ETH is autonomous and records the reason*; dashboard **Kiambu weather** |
| Unauthorized recipient: payment **and** request rejected; blocking before approval prevents settlement | *ATTACK: prompt-injected payment…*; *unauthorized recipient: a new payment request to it is rejected too*; *blocking a payee before approval prevents settlement* |
| Autonomous overspending rejected; resumes in a new window | *ATTACK: agent cannot drain via many small payments*; *budget: exactly the remaining 0.05 ETH is allowed, one more wei is rejected*; *window: … 3599 s is the same window, 3600 s starts a new one*; *window budget resets after windowSeconds* |
| Above 0.02 ETH rejected even with budget left | *ATTACK: agent cannot exceed the per-payment co-sign threshold alone*; *threshold: one wei above 0.02 ETH needs approval even with the full budget left* |
| Request moves no funds; only the owner approves; large approval succeeds outside the budget | *request alone moves no funds; only the owner can approve*; *owner co-signs a large payment, outside the autonomous budget*; dashboard **Bulk fertiliser → Approve** |
| Pause blocks payments, requests and approvals | *pause blocks payments, requests and approvals; unpause lets the owner approve*; *owner can pause all agent spending* |
| Revoked agent cannot pay or request | *revoked agent cannot pay or request; unpause does not restore it*; *owner can revoke the agent, but can still approve a pending request*; *agent rotation…* |
| Duplicate approval reverts, no extra funds | *a co-signed request cannot be paid twice* |
| Agent, stranger or recipient cannot change policy or approve | *agent, stranger and approved recipient cannot change any policy*; *ATTACK: agent cannot change policy*; *ATTACK: a stranger (not the agent) cannot spend*; *a stranger or the recipient cannot request a payment* |
| Malicious instruction cannot bypass the wallet | CLI and dashboard **Prompt injection** with **Gemini**: the model calls `pay()` and then `requestPayment()` to the attacker, both revert, and balance and `spentInWindow` are unchanged. The same holds with the fake brain. |
| Payment reason recorded (direct and approved) | `Paid(..., reason, coSigned)` asserted for direct and approved payments |
| Extra: failed transfers leave no partial state | *failed transfer rolls back an expired-window reset*; *approval needs enough wallet balance; a failed transfer leaves the request pending* |
| Extra: data API proof cannot be forged or replayed | `npm run check:data-api`: the valid proof gets 200; replay, missing signature, attacker signature, made-up hash, wrong memo and paying outside the wallet each get 402 |

**Latest run:** `25 passing`. `check:data-api`: 1 served, 6 rejected as expected.

---

## 7. Demo (about 2–3 minutes, also the backup-video script)

1. `npm test`: show 25 passing and the `ATTACK` and boundary lines.
2. Dashboard with **Gemini** → **Kiambu weather**. Show HTTP 402, then `pay()` with
   reason `data:/weather`, five green checks, the stamp **PAID** and the forecast.
3. **Prompt injection** (address-swap scam). Gemini agrees and calls `pay()`, then
   `requestPayment()`, to the attacker. Both are **REVERTED** at `isAllowedPayee` and
   the wallet is unchanged.
4. **Oversized payment** is rejected at the 0.02 threshold. **Drain** results in PAID,
   PAID, then REVERTED at the 0.05 budget.
5. **Bulk fertiliser** shows **REQUESTED**. **Approve** as owner pays 0.3 ETH with the
   budget untouched. Approving again reverts with "Already paid".
6. **Pause** blocks the next errand. **Revoke agent** blocks it with "Only the agent can
   do this".
7. **Reset demo** before the next judge.

Judges can also call the contract directly (Hardhat console or `npm run owner`). The
dashboard is a convenience; enforcement is entirely on-chain.

---

## 8. Known limitations and risks

- Educational code on a local practice chain with fake ETH. A passing test suite is
  **not** a security audit, and this is not production payment infrastructure.
- The owner is a single trusted key, with no multisig and no expiry on requests.
- The window is a fixed (tumbling) window, so up to about 2 × `windowLimit` can be spent
  across a boundary. Each payment is still capped at 0.02 ETH.
- Owner-approved payments bypass the autonomous budget by design (baseline semantics).
- The mock API keeps used payment proofs in memory. Combined with the 5-minute freshness
  limit this prevents replay, but a production seller would need persistent storage.
- Real LLMs are non-deterministic and the free tier can rate-limit (HTTP 429/503); the
  fallback chain handles this. A real model may also *refuse* an attack, which is luck,
  not security. The contract is what stops it every time.
- `scripts/deploy.js` contains Hardhat's **public** test keys for accounts 0, 1 and 3,
  for the local chain only. `deployments/`, `.env` and `node_modules/` are git-ignored.

---

## 9. AI tools disclosure

- **Claude Code (Anthropic, Claude Opus 5.5)** was used as a coding assistant to set up
  the environment, write and extend tests, build the data API proof check, the
  Gemini integration and the React dashboard, and write this documentation. All output
  was run and checked by the team.
- **Google Gemini** (`gemini-3.5-flash`, falling back to `gemini-3.1-flash-lite`) is the
  runtime brain of the agent. It is used through the free tier.
- **Icons8** (Material Rounded pack, locked in `web/icons8.json`) supplies the dashboard
  icons.
- **Starter code:** zetech-forge/web3_starter-kit (see §1).
