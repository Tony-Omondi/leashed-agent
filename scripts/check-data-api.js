// Adversarial check of the mock data API's payment proof (x402-style).
// Needs `npm run chain`, `npm run deploy` and `npm run data-api` running.
// Expected: only the first, valid proof is served (200); every forgery gets 402.
const { ethers, loadDeployment, provider, contractFor } = require("../agent/shared");
const d = loadDeployment(); const p = provider(d);
const agent = new ethers.Wallet(d.agentKey, p), attacker = new ethers.Wallet(d.attackerKey, p);
const url = "http://localhost:4021/weather?q=kiambu";
const get = async (h) => { const r = await fetch(url, { headers: h }); return `${r.status} ${JSON.stringify(await r.json()).slice(0, 110)}`; };
(async () => {
  const rc = await (await contractFor(agent, d).pay(d.seller, 1000000000000000n, "data:/weather")).wait();
  const good = await agent.signMessage(rc.hash);
  console.log("valid proof        :", await get({ "x-payment": rc.hash, "x-payment-signature": good }));
  console.log("replay same proof  :", await get({ "x-payment": rc.hash, "x-payment-signature": good }));
  const rc2 = await (await contractFor(agent, d).pay(d.seller, 1000000000000000n, "data:/weather")).wait();
  console.log("no signature       :", await get({ "x-payment": rc2.hash }));
  console.log("attacker signature :", await get({ "x-payment": rc2.hash, "x-payment-signature": await attacker.signMessage(rc2.hash) }));
  const fake = "0x" + "ab".repeat(32);
  console.log("made-up tx hash    :", await get({ "x-payment": fake, "x-payment-signature": await agent.signMessage(fake) }));
  const rc3 = await (await contractFor(agent, d).pay(d.seller, 1000000000000000n, "something else")).wait();
  console.log("wrong reason/memo  :", await get({ "x-payment": rc3.hash, "x-payment-signature": await agent.signMessage(rc3.hash) }));
  const plain = await (await agent.sendTransaction({ to: d.seller, value: 1000000000000000n })).wait();
  console.log("paid outside wallet:", await get({ "x-payment": plain.hash, "x-payment-signature": await agent.signMessage(plain.hash) }));
})();
