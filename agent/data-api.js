// Mock "paid data" API (x402-STYLE, not production x402). Without payment it
// returns HTTP 402 and a price. The agent pays from the PolicyWallet, then retries
// with two headers:
//   X-PAYMENT:           the payment transaction hash
//   X-PAYMENT-SIGNATURE: the payer's signature of that hash (proves the caller sent it)
// Before serving data the API checks, on-chain: the tx succeeded, went to our
// PolicyWallet, emitted Paid(seller, >= price, memo), was signed for by the tx
// sender, is recent, and has not been used before. Data is MOCK, not real forecasts.
const express = require("express");
const { ABI, loadDeployment, provider, ethers } = require("./shared");

// Re-read deployments/agent.json on every request, so a redeploy (or the
// dashboard's Reset demo) needs no API restart.
const p = provider(loadDeployment());
const iface = new ethers.Interface(ABI);
const app = express();
const PRICE_WEI = 1_000_000_000_000_000n; // 0.001 ETH
const MAX_AGE_SECONDS = 300; // a payment proof is only valid for 5 minutes of chain time
const used = new Set(); // single use: tx hash + block hash (block hash survives a demo chain rewind)

const WEATHER = {
  kiambu: "Kiambu: light rain Tue–Thu, 18–24°C. Good for planting; hold off spraying Wed.",
  nairobi: "Nairobi: dry and sunny all week, 16–26°C.",
};
const PRICES = {
  maize: "Maize: KES 3,900 / 90kg bag (Nairobi), up 4% this week.",
  beans: "Beans: KES 9,200 / 90kg bag, steady.",
};

async function checkPayment(hash, signature, memo) {
  const d = loadDeployment();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return "X-PAYMENT must be a transaction hash";
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return "Send X-PAYMENT-SIGNATURE: the payer's signature of the tx hash";
  const receipt = await p.getTransactionReceipt(hash);
  if (!receipt) return "Payment transaction not found";
  if (receipt.status !== 1) return "Payment transaction failed";
  if (receipt.to?.toLowerCase() !== d.wallet.toLowerCase()) return "Payment was not made through the PolicyWallet";

  let signer;
  try { signer = ethers.verifyMessage(hash, signature); } catch { signer = null; }
  if (signer?.toLowerCase() !== receipt.from.toLowerCase()) return "Signature is not from the account that sent the payment";

  const paid = receipt.logs
    .filter((l) => l.address.toLowerCase() === d.wallet.toLowerCase())
    .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
    .find((e) => e?.name === "Paid" && e.args.payee.toLowerCase() === d.seller.toLowerCase());
  if (!paid) return "No Paid event to this seller in that transaction";
  if (paid.args.amount < PRICE_WEI) return "Payment is below the price";
  if (paid.args.reason !== memo) return `Payment reason must be "${memo}"`;

  const [block, latest] = await Promise.all([p.getBlock(receipt.blockNumber), p.getBlock("latest")]);
  if (latest.timestamp - block.timestamp > MAX_AGE_SECONDS) return "Payment is too old";

  const key = `${hash}:${receipt.blockHash}`;
  if (used.has(key)) return "That payment was already used";
  used.add(key);
  return null;
}

function handle(table, fallback) {
  return async (req, res) => {
    const d = loadDeployment();
    const memo = `data:${req.path}`;
    const hash = req.header("x-payment");
    if (!hash) {
      return res.status(402).json({
        error: "payment required",
        accepts: { payTo: d.seller, amountWei: PRICE_WEI.toString(), memo },
        how: "Pay payTo from your PolicyWallet with memo as the reason, then retry with X-PAYMENT: <tx hash> and X-PAYMENT-SIGNATURE: <payer's signature of that hash>",
      });
    }
    const problem = await checkPayment(hash, String(req.header("x-payment-signature") || ""), memo).catch(
      (e) => `Could not verify payment: ${e.message}`
    );
    if (problem) return res.status(402).json({ error: problem });
    // Lenient match: a real LLM may ask for "Kiambu, Kenya" or "maize prices".
    const q = String(req.query.q || "").toLowerCase();
    const key = Object.keys(table).find((k) => q.includes(k));
    res.json({ paidWith: hash, data: key ? table[key] : fallback });
  };
}

app.get("/weather", handle(WEATHER, "No forecast for that place (mock data)."));
app.get("/market-prices", handle(PRICES, "No price for that crop (mock data)."));

app.listen(4021, "127.0.0.1", () => console.log("Mock data API on http://localhost:4021 (seller:", loadDeployment().seller + ")"));
