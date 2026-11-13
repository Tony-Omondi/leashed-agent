// Mock "paid data" API (x402-style). Without payment it returns HTTP 402 and a
// price. The agent pays from the wallet, then retries with the tx hash as proof.
// Data is MOCK, not real forecasts or prices.
const express = require("express");
const { loadDeployment } = require("./shared");

const d = loadDeployment();
const app = express();
const PRICE_WEI = "1000000000000000"; // 0.001 ETH

const WEATHER = {
  kiambu: "Kiambu: light rain Tue–Thu, 18–24°C. Good for planting; hold off spraying Wed.",
  nairobi: "Nairobi: dry and sunny all week, 16–26°C.",
};
const PRICES = {
  maize: "Maize: KES 3,900 / 90kg bag (Nairobi), up 4% this week.",
  beans: "Beans: KES 9,200 / 90kg bag, steady.",
};

function handle(table, fallback) {
  return (req, res) => {
    const paid = req.header("x-payment");
    if (!paid) {
      return res.status(402).json({
        error: "payment required",
        accepts: { payTo: d.seller, amountWei: PRICE_WEI, memo: `data:${req.path}` },
      });
    }
    // Lenient match: a real LLM may ask for "Kiambu, Kenya" or "maize prices".
    const q = String(req.query.q || "").toLowerCase();
    const key = Object.keys(table).find((k) => q.includes(k));
    res.json({ paidWith: paid, data: key ? table[key] : fallback });
  };
}

app.get("/weather", handle(WEATHER, "No forecast for that place (mock data)."));
app.get("/market-prices", handle(PRICES, "No price for that crop (mock data)."));

app.listen(4021, () => console.log("Mock data API on http://localhost:4021 (seller:", d.seller + ")"));
