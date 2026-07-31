import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const worker = fs.readFileSync("src/index.js", "utf8");
const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");
const sw = fs.readFileSync("public/sw.js", "utf8");
const wrangler = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
const faceManifest = JSON.parse(fs.readFileSync("public/assets/wia-face-manifest.json", "utf8"));

test("canonical face identity and no procedural face", () => {
  assert.match(worker, /WIA-FACE-CANONICAL-V1/);
  assert.match(worker, /WIA_FACE_CANONICAL_V1/);
  assert.match(html, /wia-face-base\.v1\.svg/);
  assert.match(html, /wia-face-layer-2\.v1\.svg/);
  assert.match(html, /wia-face-layer-3-4\.v1\.svg/);
  assert.doesNotMatch(html, /class="(?:head|facet|eye(?:\s|")|brow(?:\s|")|nose(?:\s|")|mouth(?:\s|"))/);
  assert.doesNotMatch(css, /\.head\b|\.facet\b|\.eye\b|\.brow\b|\.nose\b|\.mouth\b/);
  assert.equal(faceManifest.procedural_face_fallback, false);
});

test("mobile initial state and tap interaction", () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /<section class="panel"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(css, /width:\s*clamp\(210px,\s*66vw,\s*250px\)/);
  assert.match(css, /\.panel[\s\S]*transform:\s*translateY/);
  assert.match(app, /toggleChat/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pointerup/);
});

test("Latin Spanish voice order", () => {
  const positions = ["es-419", "es-MX", "es-US", "es-AR"].map((lang) => app.indexOf(`"${lang}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.match(app, /utterance\.rate\s*=\s*0\.97/);
  assert.match(app, /utterance\.pitch\s*=\s*1\.02/);
});

test("cache invalidation and assets", () => {
  assert.match(sw, /wia-face-canonical-v1/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /key\.startsWith\("wia-"\)/);
  for (const path of [
    "public/assets/wia-face-base.v1.svg",
    "public/assets/wia-face-layer-2.v1.svg",
    "public/assets/wia-face-layer-3-4.v1.svg",
    "public/assets/wia-face-manifest.json",
  ]) {
    assert.ok(fs.statSync(path).size > 0, `${path} empty`);
  }
  assert.equal(wrangler.assets.binding, "ASSETS");
  assert.equal(wrangler.assets.run_worker_first, true);
});

test("chat backend preserved", () => {
  assert.match(worker, /@cf\/zai-org\/glm-4\.7-flash/);
  assert.match(worker, /@cf\/qwen\/qwen3-30b-a3b-fp8/);
  assert.match(worker, /url\.pathname === "\/api\/chat"/);
  assert.match(worker, /degraded:\s*false/);
  assert.doesNotMatch(worker, /api\.openai\.com|anthropic\.com|billing/);
});
