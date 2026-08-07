import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync("src/index.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const wrangler = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));

test("bounded conversational contract is enforced", () => {
  assert.match(worker, /MESSAGE_LIMIT = 600/);
  assert.match(worker, /HISTORY_LIMIT = 8/);
  assert.match(worker, /MAX_TOKENS = 220/);
  assert.match(worker, /MODEL_ATTEMPTS = 2/);
  assert.match(html, /maxlength="600"/);
  assert.match(app, /previousHistory\.slice\(-HISTORY_LIMIT\)/);
});

test("rate limiting binding runs before inference", () => {
  assert.deepEqual(wrangler.ratelimits, [{ name: "CHAT_RATE_LIMITER", namespace_id: "9151101", simple: { limit: 12, period: 60 } }]);
  assert.match(worker, /enforceRateLimit\(request, env\)/);
  const handler = worker.slice(worker.indexOf("async function handleChat"));
  assert.ok(handler.indexOf("await enforceRateLimit") >= 0);
  assert.ok(handler.indexOf("await enforceRateLimit") < handler.indexOf("for (const model of [PRIMARY_MODEL, FALLBACK_MODEL])"));
  assert.match(app, /x-wia-client/);
});

test("only the two selected Workers AI models are candidates", () => {
  assert.match(worker, /@cf\/meta\/llama-3\.1-8b-instruct-fast/);
  assert.match(worker, /@cf\/meta\/llama-3\.2-3b-instruct/);
  assert.match(worker, /for \(const model of \[PRIMARY_MODEL, FALLBACK_MODEL\]\)/);
  assert.doesNotMatch(worker, /openai|anthropic|gemini|elevenlabs/i);
});

test("empty-model failures get bounded retry and explicit recoverable terminal error", () => {
  assert.match(worker, /runModelBounded/);
  assert.match(worker, /EMPTY_MODEL_RESPONSE/);
  assert.match(worker, /MODEL_UNAVAILABLE/);
  assert.match(worker, /recoverable:\s*true/);
  assert.match(worker, /retry_after_ms:\s*1200/);
});

test("structured protocol and anti-sycophancy policy are explicit", () => {
  for (const reaction of ["neutral", "warm", "amused", "curious", "skeptical", "surprised", "concerned"]) assert.match(worker, new RegExp(`"${reaction}"`));
  assert.match(worker, /parseStructuredModelOutput/);
  assert.match(worker, /no adulás/i);
  assert.match(worker, /no inventás certeza/i);
  assert.match(worker, /Si no sabés algo, decilo sin bluff/i);
  assert.match(worker, /No incluyas markdown, reasoning ni otras claves/);
});

test("ROAST MODE is explicit opt-in, default off and bounded", () => {
  assert.match(worker, /const roast = body\?\.roast === true/);
  assert.match(worker, /ROAST MODE está activado por opt-in explícito/);
  assert.match(worker, /no rasgos protegidos ni vulnerabilidades personales/);
  assert.match(worker, /roast_mode_default:\s*false/);
  assert.match(worker, /roast_mode_activation:\s*"explicit_opt_in"/);
});

test("append-only operational control plane exists", () => {
  for (const path of ["ops/POLICY.md", "ops/CURRENT.json", "ops/EVENTS.ndjson"]) assert.ok(fs.existsSync(path));
  const lines = fs.readFileSync("ops/EVENTS.ndjson", "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.slice(0, 3).map((event) => event.seq), [1, 2, 3]);
});
