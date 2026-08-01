import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.env.BASE_URL || "https://wia.simondalmasso44.workers.dev";
const out = path.resolve("ops/evidence/wia-v1-1");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function inspect(viewport, filename, openChat = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto(`${base}/?evidence=${Date.now()}`, { waitUntil: "networkidle" });
  await page.locator("#face").waitFor({ state: "visible" });
  if (openChat) await page.locator("#face").click();
  const metrics = await page.evaluate(() => {
    const face = document.querySelector("#face").getBoundingClientRect();
    const panel = document.querySelector("#panel");
    return {
      viewport: { width: innerWidth, height: innerHeight },
      bodyScrollWidth: document.body.scrollWidth,
      face: { x: face.x, y: face.y, width: face.width, height: face.height },
      panelHidden: panel.getAttribute("aria-hidden") === "true",
      panelInert: panel.hasAttribute("inert"),
      oldFaceNodes: document.querySelectorAll(".head,.facet,.eye,.brow,.nose,.mouth").length,
      activeFaceSources: [...document.querySelectorAll(".face picture source,.face picture img")].map((node) => node.srcset || node.src),
    };
  });
  if (metrics.bodyScrollWidth > viewport.width) throw new Error(`horizontal overflow: ${JSON.stringify(metrics)}`);
  if (!openChat && (!metrics.panelHidden || !metrics.panelInert)) throw new Error("chat visible initially");
  if (openChat && metrics.panelHidden) throw new Error("tap did not open chat");
  if (metrics.oldFaceNodes !== 0) throw new Error("old procedural face nodes active");
  await page.screenshot({ path: path.join(out, filename), fullPage: false });
  const debug = await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return window.__WIA_VOICE_DEBUG__ || null;
  });
  await context.close();
  return { metrics, voice: debug };
}

const closed360 = await inspect({ width: 360, height: 800 }, "viewport-360x800-closed.png", false);
const open360 = await inspect({ width: 360, height: 800 }, "viewport-360x800-open.png", true);
const closed430 = await inspect({ width: 430, height: 900 }, "viewport-430x900.png", false);


const voiceContext = await browser.newContext({ viewport: { width: 360, height: 800 } });
await voiceContext.addInitScript(() => {
  window.__WIA_FAKE_RECOGNITION__ = { starts: 0, stops: 0 };
  class FakeRecognition {
    constructor() { this.lang = ""; this.interimResults = false; this.continuous = false; this.maxAlternatives = 1; }
    start() { window.__WIA_FAKE_RECOGNITION__.starts += 1; this.onstart?.(); }
    stop() { window.__WIA_FAKE_RECOGNITION__.stops += 1; this.onend?.(); }
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
});
const voicePage = await voiceContext.newPage();
await voicePage.goto(base, { waitUntil: "networkidle" });
const faceBox = await voicePage.locator("#face").boundingBox();
if (!faceBox) throw new Error("face box unavailable");
await voicePage.mouse.move(faceBox.x + faceBox.width / 2, faceBox.y + faceBox.height / 2);
await voicePage.mouse.down();
await voicePage.waitForTimeout(430);
await voicePage.mouse.up();
await voicePage.waitForTimeout(100);
const holdInteraction = await voicePage.evaluate(() => ({
  recognition: window.__WIA_FAKE_RECOGNITION__,
  panelHidden: document.querySelector("#panel").getAttribute("aria-hidden") === "true",
  state: window.__WIA_INTERACTION_DEBUG__?.getState?.(),
}));
if (holdInteraction.recognition.starts !== 1 || holdInteraction.recognition.stops !== 1) throw new Error(`long press failed: ${JSON.stringify(holdInteraction)}`);
if (!holdInteraction.panelHidden) throw new Error("long press triggered accidental tap");
await voiceContext.close();

const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
const page = await context.newPage();
await page.goto(base, { waitUntil: "networkidle" });
await page.locator("#face").click();
await page.locator("#input").fill("Respondé en una frase breve: hola.");
await page.locator("form").evaluate((form) => form.requestSubmit());
await page.waitForFunction(() => document.querySelectorAll(".msg.wia").length >= 2, null, { timeout: 150000 });
const interaction = await page.evaluate(() => ({
  messages: document.querySelectorAll(".msg").length,
  status: document.querySelector("#status").textContent,
  state: window.__WIA_INTERACTION_DEBUG__?.getState?.(),
}));
await context.close();
await browser.close();

fs.writeFileSync(path.join(out, "viewport-metrics.json"), JSON.stringify({ closed360, open360, closed430, holdInteraction, interaction }, null, 2) + "\n");
fs.writeFileSync(path.join(out, "voice-inventory.json"), JSON.stringify({
  captured_in: "GitHub Actions headless Chromium",
  physical_device_required: true,
  inventory: closed360.voice?.inventory || [],
  platform: closed360.voice?.platform || "",
  userAgent: closed360.voice?.userAgent || "",
}, null, 2) + "\n");
fs.writeFileSync(path.join(out, "voice-selection.json"), JSON.stringify({
  selector_version: closed360.voice?.selectorVersion || "WIA_LATAM_VOICE_SELECTOR_V1_1",
  selected: closed360.voice?.selected || null,
  selected_score: closed360.voice?.selectedScore ?? null,
  reason: closed360.voice?.reason || "headless browser exposed no voice",
  preset: closed360.voice?.preset || null,
  physical_naturalness_validation: "PENDING_SIMON",
}, null, 2) + "\n");
