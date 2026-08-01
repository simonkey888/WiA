import { VOICE_SELECTOR_VERSION, ACTIVE_PRESET, chooseVoice } from "./voice-selector.js";

const CACHE_PREFIX = "wia-";

const app = document.getElementById("app");
const face = document.getElementById("face");
const panel = document.getElementById("panel");
const form = document.getElementById("form");
const input = document.getElementById("input");
const messages = document.getElementById("messages");
const statusEl = document.getElementById("status");
const submitButton = form.querySelector("button");

let history = [];
let pressTimer = 0;
let pressActive = false;
let longPressTriggered = false;
let recognition = null;
let speaking = false;
let speechGeneration = 0;
let selectedVoice = null;
let voiceInventory = [];


function clientId() {
  const key = "wia-client-v1-1";
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function setVisualHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--visual-height", `${Math.round(height)}px`);
  requestAnimationFrame(scrollToLastMessage);
}
setVisualHeight();
window.addEventListener("resize", setVisualHeight, { passive: true });
window.visualViewport?.addEventListener("resize", setVisualHeight, { passive: true });
window.visualViewport?.addEventListener("scroll", setVisualHeight, { passive: true });

function setChatOpen(open) {
  app.classList.toggle("open", open);
  panel.toggleAttribute("inert", !open);
  panel.setAttribute("aria-hidden", String(!open));
  if (open) {
    requestAnimationFrame(() => {
      scrollToLastMessage();
      input.focus({ preventScroll: true });
    });
  } else {
    input.blur();
  }
}

function toggleChat() {
  setChatOpen(!app.classList.contains("open"));
}

function scrollToLastMessage() {
  messages.scrollTop = messages.scrollHeight;
}

function addMessage(role, text) {
  const element = document.createElement("div");
  element.className = `msg ${role === "user" ? "user" : "wia"}`;
  element.textContent = text;
  messages.append(element);
  history.push({ role: role === "user" ? "user" : "assistant", content: text });
  history = history.slice(-8);
  scrollToLastMessage();
}

function autoGrowInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
}
input.addEventListener("input", autoGrowInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

function serializeVoice(voice) {
  return {
    name: voice.name,
    lang: voice.lang,
    localService: Boolean(voice.localService),
    default: Boolean(voice.default),
    voiceURI: voice.voiceURI,
  };
}

function refreshVoices() {
  if (!("speechSynthesis" in window)) return;
  voiceInventory = speechSynthesis.getVoices().map(serializeVoice);
  const liveVoices = speechSynthesis.getVoices();
  const choice = chooseVoice(liveVoices);
  selectedVoice = choice?.voice || null;
  window.__WIA_VOICE_DEBUG__ = {
    selectorVersion: VOICE_SELECTOR_VERSION,
    inventory: voiceInventory,
    selected: selectedVoice ? serializeVoice(selectedVoice) : null,
    selectedScore: choice?.score ?? null,
    reason: choice ? "highest deterministic score: language, quality terms, explicit allowlist, quality denylist, service type" : "no Spanish voice exposed by browser",
    preset: ACTIVE_PRESET,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
  };
}
refreshVoices();
if ("speechSynthesis" in window) speechSynthesis.addEventListener("voiceschanged", refreshVoices);

function normalizeSpeechText(text) {
  return String(text)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~>|]/g, "")
    .replace(/@cf\/[\w./-]+/g, "")
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
}

function splitSpeech(text) {
  const normalized = normalizeSpeechText(text);
  if (!normalized) return [];
  return normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g)?.map((part) => part.trim()).filter(Boolean) || [normalized];
}

function stopSpeech() {
  speechGeneration += 1;
  speaking = false;
  face.classList.remove("speaking");
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

async function speak(text) {
  if (!("speechSynthesis" in window)) return;
  stopSpeech();
  refreshVoices();
  const chunks = splitSpeech(text);
  if (!chunks.length) return;
  const generation = ++speechGeneration;
  speaking = true;
  face.classList.add("speaking");

  for (const chunk of chunks) {
    if (generation !== speechGeneration) break;
    await new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(chunk);
      if (selectedVoice) utterance.voice = selectedVoice;
      utterance.lang = selectedVoice?.lang || "es-419";
      utterance.rate = ACTIVE_PRESET.rate;
      utterance.pitch = ACTIVE_PRESET.pitch;
      utterance.volume = ACTIVE_PRESET.volume;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      speechSynthesis.speak(utterance);
    });
    if (generation === speechGeneration) await new Promise((resolve) => setTimeout(resolve, 105));
  }
  if (generation === speechGeneration) {
    speaking = false;
    face.classList.remove("speaking");
  }
}

async function send(text) {
  const message = text.trim();
  if (!message) return;
  stopSpeech();
  setChatOpen(true);
  const previousHistory = history.slice();
  addMessage("user", message);
  input.value = "";
  autoGrowInput();
  submitButton.disabled = true;
  statusEl.textContent = "Pensando…";
  face.classList.add("thinking");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "x-wia-client": clientId() },
      body: JSON.stringify({ message, history: previousHistory.slice(-8) }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error(data.error || `HTTP_${response.status}`);
    }
    addMessage("assistant", data.reply.trim());
    statusEl.textContent = data.model || "";
    await speak(data.reply);
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    face.classList.remove("thinking");
    submitButton.disabled = false;
    scrollToLastMessage();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void send(input.value);
});

function recognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function beginListening() {
  stopSpeech();
  const Recognition = recognitionCtor();
  if (!Recognition) {
    setChatOpen(true);
    statusEl.textContent = "El navegador no habilitó dictado por voz.";
    return;
  }
  recognition = new Recognition();
  recognition.lang = "es-AR";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    face.classList.add("listening");
    statusEl.textContent = "Te escucho…";
  };
  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim() || "";
    if (transcript) void send(transcript);
  };
  recognition.onerror = (event) => {
    if (event.error !== "aborted") statusEl.textContent = `Micrófono: ${event.error}`;
  };
  recognition.onend = () => {
    face.classList.remove("listening");
    recognition = null;
  };
  recognition.start();
}

function finishListening() {
  if (recognition) {
    try { recognition.stop(); } catch {}
  }
}

face.addEventListener("pointerdown", (event) => {
  if (speaking) {
    stopSpeech();
    event.preventDefault();
    return;
  }
  pressActive = true;
  longPressTriggered = false;
  face.setPointerCapture?.(event.pointerId);
  clearTimeout(pressTimer);
  pressTimer = window.setTimeout(() => {
    if (!pressActive) return;
    longPressTriggered = true;
    beginListening();
  }, 380);
});

face.addEventListener("pointerup", (event) => {
  const wasLong = longPressTriggered;
  pressActive = false;
  clearTimeout(pressTimer);
  finishListening();
  if (!wasLong && !speaking) toggleChat();
  face.releasePointerCapture?.(event.pointerId);
});

face.addEventListener("pointercancel", () => {
  pressActive = false;
  clearTimeout(pressTimer);
  finishListening();
});
face.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (speaking) stopSpeech(); else toggleChat();
  }
});

function scheduleBlink() {
  const delay = 4000 + Math.random() * 5000;
  setTimeout(() => {
    if (!document.hidden && !face.classList.contains("listening")) {
      face.classList.add("blinking");
      setTimeout(() => face.classList.remove("blinking"), 180);
    }
    scheduleBlink();
  }, delay);
}
scheduleBlink();

async function clearLegacyCaches() {
  if (!("caches" in window)) return;
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== "wia-v1-1-shell-20260731").map((name) => caches.delete(name)));
}
void clearLegacyCaches();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {}));
}

window.__WIA_INTERACTION_DEBUG__ = {
  version: "WIA_INTERACTION_V1_1",
  open: () => setChatOpen(true),
  close: () => setChatOpen(false),
  stopSpeech,
  getState: () => ({ open: app.classList.contains("open"), speaking, listening: Boolean(recognition), historyLength: history.length }),
};
