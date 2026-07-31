const WORKSET = "WIA-FACE-CANONICAL-V1";
const MARKER = "WIA_FACE_CANONICAL_V1";
const PRIMARY_MODEL = "@cf/zai-org/glm-4.7-flash";
const FALLBACK_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

const SYSTEM_PROMPT = `Sos WiA, una presencia conversacional femenina. Hablás en español rioplatense natural, con frases relativamente cortas. Sos directa, perceptiva y tenés criterio propio. No adulás ni das la razón porque sí. Si algo es flojo, incoherente o riesgoso, lo decís con tacto. No uses muletillas de asistente, lenguaje corporativo, entusiasmo automático ni frases como "como inteligencia artificial". Respondé solamente el contenido útil para la conversación.`;

const apiHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "permissions-policy": "microphone=(self)",
  "x-content-type-options": "nosniff",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: apiHeaders });
}

function extractText(output) {
  if (!output) return "";
  if (typeof output === "string") return output.trim();

  const direct = [
    output.response,
    output.result?.response,
    output.result,
    output.output_text,
    output.text,
    output.answer,
  ];
  for (const value of direct) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  const choices = Array.isArray(output.choices) ? output.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
    if (Array.isArray(content)) {
      const parts = content.flatMap((part) => {
        if (typeof part === "string") return [part];
        if (typeof part?.text === "string") return [part.text];
        return [];
      });
      const joined = parts.join("\n").trim();
      if (joined) return joined;
    }
    if (typeof choice?.text === "string" && choice.text.trim()) return choice.text.trim();
  }

  if (Array.isArray(output.output)) {
    const pieces = [];
    for (const item of output.output) {
      if (typeof item === "string") pieces.push(item);
      if (typeof item?.text === "string") pieces.push(item.text);
      if (Array.isArray(item?.content)) {
        for (const content of item.content) {
          if (typeof content?.text === "string") pieces.push(content.text);
        }
      }
    }
    return pieces.join("\n").trim();
  }
  return "";
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-12).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
    const content = typeof item.content === "string" ? item.content.trim().slice(0, 4000) : "";
    return role && content ? [{ role, content }] : [];
  });
}

async function runModel(env, model, messages) {
  const output = await env.AI.run(model, {
    messages,
    max_tokens: 420,
    temperature: 0.72,
  });
  const reply = extractText(output).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!reply) throw new Error("EMPTY_MODEL_RESPONSE");
  return reply;
}

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "INVALID_JSON" }, 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ ok: false, error: "MESSAGE_REQUIRED" }, 400);
  if (message.length > 6000) return json({ ok: false, error: "MESSAGE_TOO_LONG" }, 413);

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...normalizeHistory(body?.history),
    { role: "user", content: message },
  ];

  const failures = [];
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    try {
      const reply = await runModel(env, model, messages);
      return json({
        ok: true,
        reply,
        degraded: false,
        model,
        reaction: "neutral",
        intensity: 0.5,
      });
    } catch (error) {
      failures.push({ model, error: String(error?.message || error).slice(0, 300) });
    }
  }
  return json({ ok: false, error: "MODEL_UNAVAILABLE", failures }, 503);
}

async function serveAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("permissions-policy", "microphone=(self)");
  headers.set("x-content-type-options", "nosniff");

  const pathname = new URL(request.url).pathname;
  if (pathname === "/" || pathname === "/index.html") {
    headers.set("cache-control", "no-store");
  } else if (pathname === "/sw.js" || pathname === "/manifest.webmanifest") {
    headers.set("cache-control", "no-cache, must-revalidate");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: apiHeaders });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({
        ok: true,
        worker: "wia",
        workset: WORKSET,
        marker: MARKER,
        model: PRIMARY_MODEL,
        fallback: FALLBACK_MODEL,
        mobile_first: true,
        pwa: true,
        face_asset: "/assets/wia-face-base.v1.svg",
      });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      return handleChat(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "NOT_FOUND" }, 404);
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return serveAsset(request, env);
    }

    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  },
};
