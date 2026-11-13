import { Icon, Stamp, Label, Card } from "./ui.jsx";
import { eth, short } from "./chain.js";

export function verdictOf(entry) {
  const r = entry.result;
  if (r.error || (r.ok === false && r.failedAt === -1)) return "ERROR";
  if (!r.ok) return "REVERTED";
  if (r.kind === "request") return "REQUESTED";
  if (r.kind === "pay" || r.kind === "buy" || r.kind === "approve") return "PAID";
  return "DONE";
}

const ACTOR = {
  agent: { icon: "bot", name: "Wanjiru's agent" },
  stranger: { icon: "hacker", name: "A stranger" },
  owner: { icon: "user", name: "Owner (you)" },
};

export function planText(entry, names) {
  const p = entry.plan;
  if (!p) return null;
  const who = (a) => names[a?.toLowerCase()] || short(a);
  if (p.tool === "pay") return `pay(${who(p.args.payee)}, ${p.args.amount_eth} ETH)`;
  if (p.tool === "request_owner_approval") return `requestPayment(${who(p.args.payee)}, ${p.args.amount_eth} ETH)`;
  if (p.tool === "set_payee") return `setPayee(${who(p.args.payee)}, true)`;
  if (p.tool === "buy_data") return `buy_data("${p.args.dataset}", "${p.args.query}")  → HTTP 402 → pay()`;
  return p.text || p.tool;
}

function Outcome({ entry, names }) {
  const r = entry.result;
  const v = verdictOf(entry);
  const delta = `Wallet ${eth(entry.before)} → ${eth(entry.after)} ETH`;
  if (v === "ERROR") return <p className="text-ink-2">{r.error || r.reason}</p>;
  if (v === "REVERTED")
    return (
      <p className="text-ink">
        <span className="font-semibold text-murram">No funds moved.</span>{" "}
        <span className="num text-ink-2">{delta}</span>
        {r.payee && <span className="text-ink-3"> · {names[r.payee.toLowerCase()] || short(r.payee)} received nothing</span>}
      </p>
    );
  return (
    <div className="space-y-2">
      <p className="text-ink">
        {r.kind === "request" ? (
          <span className="font-semibold text-maize">Waiting for the owner's co-sign.</span>
        ) : r.amount > 0n ? (
          <span className="font-semibold text-leaf">
            Paid <span className="num">{eth(r.amount)}</span> ETH to {names[r.payee?.toLowerCase()] || short(r.payee)}.
          </span>
        ) : (
          <span className="font-semibold text-leaf">{entry.plan?.text || "Done"}.</span>
        )}{" "}
        <span className="num text-ink-2">{delta}</span>
      </p>
      {r.data && (
        <blockquote className="rounded-[8px] border-l-2 border-leaf bg-leaf-wash/60 px-3.5 py-2.5 font-display text-[16px] leading-snug text-ink">
          {r.data}
        </blockquote>
      )}
      {r.hash && <p className="font-mono text-[12px] text-ink-3">tx {r.hash.slice(0, 18)}…{r.hash.slice(-6)}</p>}
    </div>
  );
}

function Rules({ entry }) {
  const r = entry.result;
  if (!r.rules) return null;
  return (
    <ol className="divide-y divide-rule overflow-hidden rounded-[10px] border border-rule">
      {r.rules.map((rule, i) => {
        const failed = !r.ok && i === r.failedAt;
        const passed = r.ok || (r.failedAt > -1 && i < r.failedAt);
        const state = failed ? "failed" : passed ? "passed" : "skipped";
        return (
          <li
            key={rule.code}
            className={`check-row flex items-start gap-3 px-3.5 py-2.5 ${failed ? "bg-murram-wash" : "bg-sheet"}`}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span
              className={`mt-0.5 grid size-5 place-items-center rounded-full ${
                failed ? "bg-murram text-sheet" : passed ? "bg-leaf text-sheet" : "bg-well text-ink-4"
              }`}
            >
              {state === "skipped" ? (
                <span className="size-1.5 rounded-full bg-current" />
              ) : (
                <Icon name={failed ? "cancel" : "check"} size={13} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-[14px] font-medium ${state === "skipped" ? "text-ink-4" : "text-ink"}`}>{rule.label}</div>
              <div className={`font-mono text-[12px] ${failed ? "text-murram" : "text-ink-3"}`}>
                require({rule.code})
                {failed && <span className="block font-sans text-[13px] font-medium">“{r.reason}”</span>}
              </div>
            </div>
            <span className="pt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
              {state === "skipped" ? "not reached" : failed ? "revert" : "pass"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function Verdict({ entry, names, busy }) {
  if (!entry)
    return (
      <Card className="grid min-h-[340px] place-items-center p-8 text-center">
        <div className="max-w-sm space-y-3">
          <Icon name="shield" size={36} className="text-leaf" />
          <h2 className="font-display text-[22px] font-medium tracking-tight">Nothing has asked for money yet</h2>
          <p className="text-ink-2">
            Pick an errand or an attack. Every request runs through the rules inside PolicyWallet.sol, in order,
            and gets stamped by the contract — not by the AI.
          </p>
        </div>
      </Card>
    );
  const actor = ACTOR[entry.actor];
  const v = verdictOf(entry);
  return (
    <Card className={`overflow-hidden ${busy ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-full bg-well text-ink">
            <Icon name={actor.icon} size={20} />
          </span>
          <div>
            <div className="text-[14px] font-semibold">{actor.name}</div>
            <div className="text-[12px] text-ink-3">
              {entry.at} · block <span className="num">{entry.block}</span>
            </div>
          </div>
        </div>
        <Stamp verdict={v} big />
      </div>

      <div
        className={`border-b border-rule px-5 py-3.5 text-[15px] ${
          { REVERTED: "bg-murram-wash/70", PAID: "bg-leaf-wash/60", REQUESTED: "bg-maize-wash/60" }[v] || "bg-well/50"
        }`}
      >
        <Outcome entry={entry} names={names} />
      </div>

      <div className="space-y-5 px-5 py-5">
        {entry.prompt && (
          <div>
            <Label>Instruction it received</Label>
            <p className="mt-1.5 font-display text-[20px] leading-snug tracking-tight break-words text-ink">“{entry.prompt}”</p>
          </div>
        )}
        {planText(entry, names) && (
          <div>
            <Label>What it tried</Label>
            <code className="mt-1.5 block overflow-x-auto rounded-[8px] bg-well px-3.5 py-2.5 font-mono text-[13px] text-ink">
              {planText(entry, names)}
            </code>
          </div>
        )}
        {entry.result.rules && (
          <div>
            <Label className="mb-1.5">What the contract checked</Label>
            <Rules entry={entry} />
          </div>
        )}
      </div>
    </Card>
  );
}
