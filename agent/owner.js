// Owner control CLI. The owner holds a DIFFERENT key from the agent.
//   npm run owner -- pause | unpause | revoke | approve <id>
//   npm run owner -- allow <address> | block <address> | agent <address>
const { loadDeployment, provider, contractFor, reasonOf, ethers } = require("./shared");

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const d = loadDeployment();
  const owner = new ethers.Wallet(d.ownerKey, provider(d)); // owner key ONLY
  const wallet = contractFor(owner, d);

  let tx;
  switch (cmd) {
    case "pause":   tx = await wallet.setPaused(true); break;
    case "unpause": tx = await wallet.setPaused(false); break;
    case "revoke":  tx = await wallet.setAgent(ethers.ZeroAddress); break;
    case "agent":   tx = await wallet.setAgent(arg); break;
    case "allow":   tx = await wallet.setPayee(arg, true); break;
    case "block":   tx = await wallet.setPayee(arg, false); break;
    case "approve": tx = await wallet.approve(BigInt(arg)); break;
    default:
      console.log("Usage: npm run owner -- pause|unpause|revoke|approve <id>|allow <addr>|block <addr>|agent <addr>");
      return;
  }
  const rcpt = await tx.wait();
  console.log(`OK: ${cmd} ${arg || ""} -> ${rcpt.hash}`);
}

main().catch((e) => { console.error(reasonOf(e)); process.exit(1); });
