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

test("Order 003 workset and health contract", () => {
  assert.match(worker, /WIA-COMPLETE-END-TO-END-V1/);
  assert.match(worker, /WIA_COMPLETE_END_TO_END_V1/);
  assert.match(worker, /WIA_LATAM_VOICE_SELECTOR_ORDER_003/);
  assert.match(worker, /roast_mode_default:\s*false/);
  assert.match(worker, /explicit_opt_in/);
  assert.match(worker, /\/api\/health/);
  assert.match(worker, /\/api\/chat/);
});

test("canonical raster face remains single active identity", () => {
  assert.match(html, /wia-face-v1-1\.webp/);
  assert.match(html, /wia-face-v1-1\.png/);
  assert.doesNotMatch(html + css + app + worker, /wia-face-base\.v1\.svg|wia-face-layer-2\.v1\.svg|wia-face-layer-3-4\.v1\.svg/);
  assert.doesNotMatch(html, /class="(?:head|facet|eye|brow|nose|mouth)\b/);
  assert.equal(manifest.old_triangulated_assets_active, false);
  assert.equal(manifest.alpha, true);
});

test("360x800 mobile initial state and keyboard-safe composition", () => {
  assert.match(html, /<section class="panel"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(html, /width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no/);
  assert.match(css, /width:\s*min\(67vw, 272px\)/);
  assert.match(css, /\.app\.open \.face\s*\{[^}]*width:\s*clamp\(164px, 46vw, 184px\)/s);
  assert.match(css, /height:\s*var\(--visual-height\)/);
  assert.match(app, /visualViewport/);
  assert.match(app, /--visual-height/);
  assert.match(app, /orientationchange/);
});

test("face hit target is stable while inner visual receives organic motion", () => {
  const faceRule = css.match(/\.face\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(faceRule, /animation:/);
  assert.match(css, /\.face-picture\s*\{[\s\S]*animation:\s*idle-visual/s);
});

test("interaction is tap-only with 280ms hold, cancellation and abort control", () => {
  assert.match(app, /LONG_PRESS_MS = 280/);
  assert.match(app, /pointerdown/);
  assert.match(app, /pointermove/);
  assert.match(app, /pointerup/);
  assert.match(app, /pointercancel/);
  assert.match(app, /contextmenu/);
  assert.match(app, /AbortController/);
  assert.match(app, /abortChat/);
  assert.match(app, /cancelListening/);
  assert.match(app, /stopSpeech/);
});

test("ROAST control is explicit, hidden with chat initially and session-scoped", () => {
  assert.match(html, /id="roastToggle"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(app, /let roastMode = false/);
  assert.match(app, /roast:\s*roastMode/);
  assert.doesNotMatch(app, /localStorage.*roast|roast.*localStorage/i);
});

test("PWA cache is rotated and API is never shell-cached", () => {
  assert.match(sw, /wia-order003-shell-20260807/);
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
});
