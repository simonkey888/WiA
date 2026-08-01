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
  assert.match(worker, /MAX_TOKENS = 180/);
  assert.match(html, /maxlength="600"/);
  assert.match(app, /previousHistory\.slice\(-8\)/);
});

test("rate limiting binding runs before inference", () => {
  assert.deepEqual(wrangler.ratelimits, [{ name: "CHAT_RATE_LIMITER", namespace_id: "9151101", simple: { limit: 12, period: 60 } }]);
  assert.match(worker, /enforceRateLimit\(request, env\)/);
  assert.ok(worker.indexOf("await enforceRateLimit") < worker.indexOf("invokeModel(env, PRIMARY_MODEL"));
  assert.match(app, /x-wia-client/);
});

test("one primary and one restricted fallback are explicit", () => {
  assert.equal((worker.match(/invokeModel\(env, PRIMARY_MODEL/g) || []).length, 1);
  assert.equal((worker.match(/invokeModel\(env, FALLBACK_MODEL/g) || []).length, 1);
  assert.doesNotMatch(worker, /for \(const model of/);
});

test("structured protocol, repair and seven reaction enum are explicit", () => {
  for (const reaction of ["neutral", "warm", "amused", "curious", "skeptical", "surprised", "concerned"]) assert.match(worker, new RegExp(`"${reaction}"`));
  assert.match(worker, /parseStructuredModelOutput/);
  assert.match(worker, /classifyReaction/);
  assert.match(worker, /repaired/);
  assert.match(worker, /No incluyas markdown, reasoning ni otras claves/);
});

test("append-only operational control plane exists", () => {
  for (const path of ["ops/POLICY.md", "ops/CURRENT.json", "ops/EVENTS.ndjson"]) assert.ok(fs.existsSync(path));
  const lines = fs.readFileSync("ops/EVENTS.ndjson", "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(lines.map((event) => event.seq), [1, 2, 3]);
});
