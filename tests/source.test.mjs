import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const worker = read("src/index.js");
const html = read("public/index.html");
const css = read("public/styles.css");
const app = read("public/app.js");
const sw = read("public/sw.js");
const manifest = JSON.parse(read("public/assets/wia-face-v1-1-manifest.json"));

test("workset and health contract", () => {
  assert.match(worker, /WIA-FACE-VOICE-UX-V1_1/);
  assert.match(worker, /WIA_FACE_VOICE_UX_V1_1/);
  assert.match(worker, /WIA_LATAM_VOICE_SELECTOR_V1_1/);
  assert.match(worker, /\/api\/health/);
  assert.match(worker, /\/api\/chat/);
  assert.match(worker, /@cf\/zai-org\/glm-4\.7-flash/);
  assert.match(worker, /@cf\/qwen\/qwen3-30b-a3b-fp8/);
});

test("new raster face is active and old triangulated assets are absent", () => {
  assert.match(html, /wia-face-v1-1\.webp/);
  assert.match(html, /wia-face-v1-1\.png/);
  assert.doesNotMatch(html + css + app + worker, /wia-face-base\.v1\.svg|wia-face-layer-2\.v1\.svg|wia-face-layer-3-4\.v1\.svg/);
  assert.doesNotMatch(html, /class="(?:head|facet|eye|brow|nose|mouth)\b/);
  assert.equal(manifest.old_triangulated_assets_active, false);
  assert.equal(manifest.alpha, true);
});

test("mobile initial state and composition", () => {
  assert.match(html, /<section class="panel"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /width:\s*min\(78vw, 286px\)/);
  assert.match(css, /\.app\.open \.face\s*\{[^}]*width:\s*clamp\(166px, 46vw, 190px\)/s);
  assert.match(css, /overflow:\s*hidden/);
  assert.match(app, /visualViewport/);
});

test("interaction and cache contracts", () => {
  assert.match(app, /pointerdown/);
  assert.match(app, /pointerup/);
  assert.match(app, /380/);
  assert.match(app, /stopSpeech/);
  assert.match(sw, /wia-v1-1-shell-20260731/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /caches\.delete/);
});
