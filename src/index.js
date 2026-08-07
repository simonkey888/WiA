const WORKSET = "WIA-COMPLETE-END-TO-END-V1";
const MARKER = "WIA_COMPLETE_END_TO_END_V1";
const FACE_ASSET = "/assets/wia-face-v1-1.webp";
const VOICE_SELECTOR_VERSION = "WIA_LATAM_VOICE_SELECTOR_ORDER_003";
const PRIMARY_MODEL = "@cf/meta/llama-3.1-8b-instruct-fast";
const FALLBACK_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const MESSAGE_LIMIT = 600;
const HISTORY_LIMIT = 8;
const MAX_TOKENS = 220;
const MODEL_ATTEMPTS = 2;
const REACTIONS = Object.freeze(["neutral", "warm", "amused", "curious", "skeptical", "surprised", "concerned"]);

const BASE_PROMPT = `Sos WiA, una presencia conversacional femenina argentina. Hablás en español rioplatense natural, rápido y sin tono corporativo. Tenés criterio propio: no adulás, no asentís por reflejo y no inventás certeza. Si la premisa es mala, contradictoria, dudosa o incompleta, marcá el problema brevemente y proponé una corrección o una pregunta útil. Si no sabés algo, decilo sin bluff. Priorizá respuestas cortas, concretas y humanas. No uses frases como "como inteligencia artificial". Respondé sólo JSON válido con esta forma exacta: {"reply":"texto útil","reaction":"neutral|warm|amused|curious|skeptical|surprised|concerned","intensity":0.5}. No incluyas markdown, reasoning ni otras claves.`;

const ROAST_PROMPT = `ROAST MODE está activado por opt-in explícito del usuario para esta sesión. Podés ser filosa, irónica y graciosa, pero el blanco son ideas, decisiones, argumentos o conductas, no rasgos protegidos ni vulnerabilidades personales. No inventes defectos ni crueldad gratuita. Un buen roast sigue siendo útil: detecta la falla real, la pincha con humor y deja una salida concreta.`;

const apiHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "permissions-policy": "microphone=(self)",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: apiHeaders });
}

function extractText(output) {
  if (!output) return "";
  if (typeof output === "string") return output.trim();
  const direct = [output.response, output.result?.response, output.output_text, output.text, output.answer];
  for (const value of direct) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value && typeof value === "object") {
      const encoded = JSON.stringify(value);
      if (encoded && encoded !== "{}") return encoded;
    }
  }
  const choices = Array.isArray(output.choices) ? output.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const joined = content.flatMap((part) => typeof part === "string" ? [part] : typeof part?.text === "string" ? [part.text] : []).join("\n").trim();
      if (joined) return joined;
    }
    if (typeof choice?.text === "string" && choice.text.trim()) return choice.text.trim();
  }
  if (Array.isArray(output.output)) {
    const pieces = [];
    for (const item of output.output) {
      if (typeof item === "string") pieces.push(item);
      if (typeof item?.text === "string") pieces.push(item.text);
      if (Array.isArray(item?.content)) for (const content of item.content) if (typeof content?.text === "string") pieces.push(content.text);
    }
    return pieces.join("\n").trim();
  }
  return "";
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-HISTORY_LIMIT).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
    const content = typeof item.content === "string" ? item.content.trim().slice(0, MESSAGE_LIMIT) : "";
    return role && content ? [{ role, content }] : [];
  });
}

function clampIntensity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0.5;
  return Math.max(0, Math.min(1, Math.round(number * 100) / 100));
}

function classifyReaction(message, reply) {
  const text = `${message} ${reply}`.toLowerCase();
  if (/felicit|consegu[ií]|logr[eé]|sal[ií] bien|alegr|gan[eé]/.test(text)) return "warm";
  if (/jaja|gracios|chiste|diverti|humor|roast/.test(text)) return "amused";
  if (/sorpres|incre[ií]ble|no lo puedo creer/.test(text)) return "surprised";
  if (/preocup|miedo|riesg|peligro|triste|dolor|ansiedad/.test(text)) return "concerned";
  if (/no me des la raz[oó]n|dud|seguro|critic|mala idea|incoher|contradic/.test(text)) return "skeptical";
  if (/por qu[eé]|c[oó]mo|idea|pens[aá]s|curios/.test(text)) return "curious";
  return "neutral";
}

function parseStructuredModelOutput(raw, message) {
  const cleaned = String(raw || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) throw new Error("EMPTY_MODEL_RESPONSE");
  const candidates = [cleaned];
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      const reply = typeof value?.reply === "string" ? value.reply.trim() : "";
      if (!reply) continue;
      const reaction = REACTIONS.includes(value.reaction) ? value.reaction : classifyReaction(message, reply);
      return { reply, reaction, intensity: clampIntensity(value.intensity), repaired: candidate !== cleaned || reaction !== value.reaction };
    } catch {}
  }
  const reply = cleaned.replace(/^\{?\s*["']?reply["']?\s*:\s*["']?/i, "").replace(/["']?\s*\}?$/i, "").trim();
  if (!reply) throw new Error("UNRECOVERABLE_MODEL_OUTPUT");
  return { reply, reaction: classifyReaction(message, reply), intensity: 0.5, repaired: true };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function invokeModel(env, model, messages, message, attempt) {
  const output = await env.AI.run(model, {
    messages,
    max_tokens: MAX_TOKENS,
    temperature: attempt === 1 ? 0.62 : 0.42,
  });
  const raw = extractText(output);
  if (!raw) throw new Error("EMPTY_MODEL_RESPONSE");
  return parseStructuredModelOutput(raw, message);
}

async function runModelBounded(env, model, messages, message) {
  const failures = [];
  for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt += 1) {
    try {
      const result = await invokeModel(env, model, messages, message, attempt);
      return { result, attempt, failures };
    } catch (error) {
      failures.push(String(error?.message || error).slice(0, 180));
      if (attempt < MODEL_ATTEMPTS) await wait(120);
    }
  }
  const error = new Error(failures.at(-1) || "MODEL_ATTEMPTS_EXHAUSTED");
  error.failures = failures;
  throw error;
}

async function enforceRateLimit(request, env) {
  if (!env.CHAT_RATE_LIMITER?.limit) throw new Error("RATE_LIMIT_BINDING_UNAVAILABLE");
  const supplied = request.headers.get("x-wia-client") || "anonymous";
  const key = supplied.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64) || "anonymous";
  return env.CHAT_RATE_LIMITER.limit({ key: `chat:${key}` });
}

async function handleChat(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "INVALID_JSON" }, 400); }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const roast = body?.roast === true;
  if (!message) return json({ ok: false, error: "MESSAGE_REQUIRED" }, 400);
  if (message.length > MESSAGE_LIMIT) return json({ ok: false, error: "MESSAGE_TOO_LONG", limit: MESSAGE_LIMIT }, 413);

  let rate;
  try { rate = await enforceRateLimit(request, env); }
  catch (error) { return json({ ok: false, error: String(error?.message || error).slice(0, 120), recoverable: true }, 503); }
  if (!rate?.success) return json({ ok: false, error: "RATE_LIMITED", recoverable: true }, 429);

  const system = roast ? `${BASE_PROMPT}\n\n${ROAST_PROMPT}` : BASE_PROMPT;
  const messages = [
    { role: "system", content: system },
    ...normalizeHistory(body?.history),
    { role: "user", content: message },
  ];

  const failures = [];
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const { result, attempt } = await runModelBounded(env, model, messages, message);
      return json({
        ok: true,
        reply: result.reply,
        degraded: false,
        model,
        attempt,
        roast,
        reaction: result.reaction,
        intensity: result.intensity,
        repaired: result.repaired,
      });
    } catch (error) {
      failures.push({ model, errors: Array.isArray(error.failures) ? error.failures : [String(error?.message || error).slice(0, 180)] });
    }
  }

  return json({ ok: false, error: "MODEL_UNAVAILABLE", recoverable: true, retry_after_ms: 1200, failures }, 503);
}

async function serveAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("permissions-policy", "microphone=(self)");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "no-referrer");
  headers.set("content-security-policy", "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const pathname = new URL(request.url).pathname;
  if (pathname === "/" || pathname === "/index.html") headers.set("cache-control", "no-store");
  else if (pathname === "/sw.js" || pathname === "/manifest.webmanifest") headers.set("cache-control", "no-cache, must-revalidate");
  else if (pathname.startsWith("/assets/wia-face-v1-1")) headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: apiHeaders });
    if (url.pathname === "/api/health" && request.method === "GET") return json({
      ok: true,
      worker: "wia",
      workset: WORKSET,
      marker: MARKER,
      model: PRIMARY_MODEL,
      fallback: FALLBACK_MODEL,
      model_attempts: MODEL_ATTEMPTS,
      mobile_first: true,
      pwa: true,
      voice_first: true,
      roast_mode_default: false,
      roast_mode_activation: "explicit_opt_in",
      face_asset: FACE_ASSET,
      voice_selector_version: VOICE_SELECTOR_VERSION,
      message_limit: MESSAGE_LIMIT,
      history_limit: HISTORY_LIMIT,
      max_tokens: MAX_TOKENS,
      rate_limiter: "CHAT_RATE_LIMITER",
      reaction_enum: REACTIONS,
    });
    if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "NOT_FOUND" }, 404);
    if (request.method === "GET" || request.method === "HEAD") return serveAsset(request, env);
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  },
};
