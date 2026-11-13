// The agent's real-model brains, tried in this order until one answers. Used by
// the CLI agent (agent.js) and the dashboard's server (web/api.js).
// Model names and endpoints are fixed here. API KEYS ARE NEVER IN THE REPO: they
// come from the git-ignored .env locally, or the host's secret settings.
// If every brain fails, callers fall back to the deterministic fake brain.
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/openai";

const BRAINS = [
  { provider: "gemini", label: "Gemini 3.5 Flash", baseUrl: GEMINI, model: "gemini-3.5-flash", keyVar: "LLM_API_KEY" },
  { provider: "gemini", label: "Gemini 3.1 Flash Lite", baseUrl: GEMINI, model: "gemini-3.1-flash-lite", keyVar: "LLM_API_KEY" },
  { provider: "groq", label: "Groq GPT-OSS 120B", baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", keyVar: "GROQ_API_KEY" },
  // Local Ollama needs no key; it is simply skipped when it isn't running.
  { provider: "ollama", label: "Ollama Qwen 2.5 3B", baseUrl: "http://localhost:11434/v1", model: "qwen2.5:3b", keyVar: null },
];

function brains(env = process.env) {
  return BRAINS.filter((b) => !b.keyVar || env[b.keyVar]).map((b) => ({ ...b, key: b.keyVar ? env[b.keyVar] : "" }));
}

// A keyed (hosted) brain is configured; Ollama alone doesn't count.
function configured(env = process.env) {
  return brains(env).find((b) => b.keyVar) || null;
}

// Gemini attaches "thought signatures" to tool calls (extra_content). Other
// providers reject unknown fields, so strip them when handing over mid-conversation.
function messagesFor(provider, messages) {
  if (provider === "gemini") return messages;
  return messages.map(({ extra_content, ...m }) =>
    m.tool_calls ? { ...m, tool_calls: m.tool_calls.map(({ extra_content: _x, ...t }) => t) } : m
  );
}

async function chat({ messages, tools }, env = process.env, log = () => {}) {
  const errors = [];
  for (const b of brains(env)) {
    try {
      const res = await fetch(`${b.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(b.key ? { authorization: `Bearer ${b.key}` } : {}) },
        body: JSON.stringify({ model: b.model, messages: messagesFor(b.provider, messages), tools, tool_choice: "auto" }),
        signal: AbortSignal.timeout(b.provider === "ollama" ? 60000 : 25000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const message = (await res.json()).choices[0].message;
      return { model: b.model, label: b.label, message };
    } catch (err) {
      const why = err.cause?.code === "ECONNREFUSED" ? "not running" : err.message;
      errors.push(`${b.label}: ${why}`);
      log(`(${b.label} unavailable: ${why}; trying next brain)`);
    }
  }
  const e = new Error(errors.join("; ") || "No LLM brain available");
  e.allFailed = true;
  throw e;
}

module.exports = { BRAINS, brains, configured, chat };
