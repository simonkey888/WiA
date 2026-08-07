import { VOICE_SELECTOR_VERSION, ACTIVE_PRESET, chooseVoice } from "./voice-selector.js";

const CACHE_PREFIX = "wia-";
const LONG_PRESS_MS = 280;
const PRESS_CANCEL_PX = 28;
const HISTORY_LIMIT = 8;

const app = document.getElementById("app");
const face = document.getElementById("face");
const panel = document.getElementById("panel");
const form = document.getElementById("form");
const input = document.getElementById("input");
const messages = document.getElementById("messages");
const statusEl = document.getElementById("status");
const submitButton = form.querySelector("button");
const roastToggle = document.getElementById("roastToggle");

let history = [];
let roastMode = false;
let pressTimer = 0;
let pressPointerId = null;
let pressOrigin = null;
let longPressTriggered = false;
let pressCancelled = false;
let recognition = null;
let recognitionTranscript = "";
let recognitionInterim = "";
let sendOnRecognitionEnd = false;
let speaking = false;
let speechGeneration = 0;
let selectedVoice = null;
let voiceInventory = [];
let chatController = null;
let interactionState = "idle";

function clientId() {
  const key = "wia-client-order003";
  let value = sessionStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(key, value);
  }
  return value;
}

function setState(next) {
  interactionState = next;
  app.dataset.state = next;
  face.classList.toggle("listening", next === "listening");
  face.classList.toggle("thinking", next === "thinking");
  face.classList.toggle("speaking", next === "speaking");
}

function setVisualHeight() {
  const viewport = window.visualViewport;
  const height = viewport?.height || window.innerHeight;
  const offsetTop = viewport?.offsetTop || 0;
  document.documentElement.style.setProperty("--visual-height", `${Math.round(height)}px`);
  document.documentElement.style.setProperty("--visual-offset-top", `${Math.round(offsetTop)}px`);
  requestAnimationFrame(scrollToLastMessage);
}
setVisualHeight();
window.addEventListener("resize", setVisualHeight, { passive: true });
window.addEventListener("orientationchange", () => setTimeout(setVisualHeight, 80), { passive: true });
window.visualViewport?.addEventListener("resize", setVisualHeight, { passive: true });
window.visualViewport?.addEventListener("scroll", setVisualHeight, { passive: true });

function setChatOpen(open, focus = true) {
  app.classList.toggle("open", open);
  panel.toggleAttribute("inert", !open);
  panel.setAttribute("aria-hidden", String(!open));
  if (open) {
    requestAnimationFrame(() => {
      scrollToLastMessage();
      if (focus) input.focus({ preventScroll: true });
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
  history = history.slice(-HISTORY_LIMIT);
  requestAnimationFrame(scrollToLastMessage);
}

function autoGrowInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
}
input.addEventListener("input", autoGrowInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

roastToggle.addEventListener("click", () => {
  roastMode = !roastMode;
  roastToggle.setAttribute("aria-pressed", String(roastMode));
  roastToggle.setAttribute("aria-label", `${roastMode ? "Desactivar" : "Activar"} ROAST MODE`);
  statusEl.textContent = roastMode ? "ROAST MODE activado para esta sesión." : "ROAST MODE desactivado.";
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
  const liveVoices = speechSynthesis.getVoices();
  voiceInventory = liveVoices.map(serializeVoice);
  const choice = chooseVoice(liveVoices);
  selectedVoice = choice?.voice || null;
  window.__WIA_VOICE_DEBUG__ = {
    selectorVersion: VOICE_SELECTOR_VERSION,
    inventory: voiceInventory,
    selected: selectedVoice ? serializeVoice(selectedVoice) : null,
    selectedScore: choice?.score ?? null,
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
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  if (interactionState === "speaking") setState(app.classList.contains("open") ? "chat" : "idle");
}

async function speak(text) {
  if (!("speechSynthesis" in window)) return;
  stopSpeech();
  refreshVoices();
  const chunks = splitSpeech(text);
  if (!chunks.length) return;
  const generation = ++speechGeneration;
  speaking = true;
  setState("speaking");

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
    if (generation === speechGeneration) await new Promise((resolve) => setTimeout(resolve, 45));
  }
  if (generation === speechGeneration) {
    speaking = false;
    setState(app.classList.contains("open") ? "chat" : "idle");
  }
}

function abortChat() {
  chatController?.abort();
  chatController = null;
}

async function send(text) {
  const message = text.trim();
  if (!message) return;
  stopSpeech();
  abortChat();
  setChatOpen(true, false);
  const previousHistory = history.slice();
  addMessage("user", message);
  input.value = "";
  autoGrowInput();
  submitButton.disabled = true;
  statusEl.textContent = "Pensando…";
  setState("thinking");
  const controller = new AbortController();
  chatController = controller;
  const timeout = setTimeout(() => controller.abort("timeout"), 22000);
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", "x-wia-client": clientId() },
      body: JSON.stringify({ message, history: previousHistory.slice(-HISTORY_LIMIT), roast: roastMode }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok || typeof data.reply !== "string" || !data.reply.trim()) {
      const code = data.error || `HTTP_${response.status}`;
      throw new Error(code);
    }
    addMessage("assistant", data.reply.trim());
    window.__WIA_LAST_MODEL__ = { model: data.model, attempt: data.attempt, repaired: data.repaired, roast: data.roast };
    statusEl.textContent = roastMode ? "ROAST MODE" : "";
    await speak(data.reply);
  } catch (error) {
    if (error?.name === "AbortError" || controller.signal.aborted) {
      statusEl.textContent = "Se cortó la respuesta. Tocá enviar para reintentar.";
    } else if (String(error?.message).includes("RATE_LIMITED")) {
      statusEl.textContent = "Demasiados mensajes seguidos. Probá de nuevo en un momento.";
    } else {
      statusEl.textContent = "El modelo no respondió. Reintentá; no te voy a vender un fallback como éxito.";
    }
  } finally {
    clearTimeout(timeout);
    if (chatController === controller) chatController = null;
    submitButton.disabled = false;
    if (!speaking) setState("chat");
    requestAnimationFrame(scrollToLastMessage);
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!submitButton.disabled) void send(input.value);
});

function recognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function resetRecognitionText() {
  recognitionTranscript = "";
  recognitionInterim = "";
}

function beginListening() {
  stopSpeech();
  abortChat();
  const Recognition = recognitionCtor();
  if (!Recognition) {
    setChatOpen(true);
    statusEl.textContent = "Este navegador no habilitó dictado. Usá el teclado.";
    return false;
  }
  if (recognition) return true;
  resetRecognitionText();
  sendOnRecognitionEnd = false;
  recognition = new Recognition();
  recognition.lang = "es-AR";
  recognition.interimResults = true;
  recognition.continuous = true;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    setState("listening");
    statusEl.textContent = "Te escucho…";
  };
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const value = event.results[i]?.[0]?.transcript || "";
      if (event.results[i].isFinal) finalText += `${value} `;
      else interimText += `${value} `;
    }
    if (finalText.trim()) recognitionTranscript = `${recognitionTranscript} ${finalText}`.trim();
    recognitionInterim = interimText.trim();
    statusEl.textContent = recognitionInterim || recognitionTranscript || "Te escucho…";
  };
  recognition.onerror = (event) => {
    if (event.error !== "aborted") statusEl.textContent = `Micrófono: ${event.error}`;
  };
  recognition.onend = () => {
    const text = `${recognitionTranscript} ${recognitionInterim}`.trim();
    const shouldSend = sendOnRecognitionEnd && !pressCancelled && Boolean(text);
    recognition = null;
    resetRecognitionText();
    sendOnRecognitionEnd = false;
    if (shouldSend) void send(text);
    else if (interactionState === "listening") setState(app.classList.contains("open") ? "chat" : "idle");
  };
  try {
    recognition.start();
    return true;
  } catch {
    recognition = null;
    setChatOpen(true);
    statusEl.textContent = "No pude iniciar el micrófono. Usá el teclado.";
    return false;
  }
}

function finishListening(sendResult) {
  if (!recognition) return;
  sendOnRecognitionEnd = sendResult;
  try { recognition.stop(); } catch {}
}

function cancelListening() {
  pressCancelled = true;
  sendOnRecognitionEnd = false;
  if (recognition) {
    try { recognition.abort(); } catch {}
  }
  statusEl.textContent = "Escucha cancelada.";
  setState(app.classList.contains("open") ? "chat" : "idle");
}

function clearPressTimer() {
  clearTimeout(pressTimer);
  pressTimer = 0;
}

function resetPress() {
  clearPressTimer();
  pressPointerId = null;
  pressOrigin = null;
}

face.addEventListener("pointerdown", (event) => {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (speaking) {
    stopSpeech();
    event.preventDefault();
    return;
  }
  if (pressPointerId !== null) return;
  pressPointerId = event.pointerId;
  pressOrigin = { x: event.clientX, y: event.clientY };
  longPressTriggered = false;
  pressCancelled = false;
  face.setPointerCapture?.(event.pointerId);
  clearPressTimer();
  pressTimer = window.setTimeout(() => {
    if (pressPointerId !== event.pointerId || pressCancelled) return;
    longPressTriggered = beginListening();
  }, LONG_PRESS_MS);
});

face.addEventListener("pointermove", (event) => {
  if (event.pointerId !== pressPointerId || !pressOrigin) return;
  const distance = Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y);
  const rect = face.getBoundingClientRect();
  const outside = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  if (distance > PRESS_CANCEL_PX && outside) {
    pressCancelled = true;
    clearPressTimer();
    if (longPressTriggered) cancelListening();
  }
});

face.addEventListener("pointerup", (event) => {
  if (event.pointerId !== pressPointerId) return;
  const wasLong = longPressTriggered;
  const wasCancelled = pressCancelled;
  clearPressTimer();
  if (wasLong && !wasCancelled) finishListening(true);
  if (!wasLong && !wasCancelled && !speaking) toggleChat();
  try { face.releasePointerCapture?.(event.pointerId); } catch {}
  resetPress();
});

face.addEventListener("pointercancel", () => {
  if (longPressTriggered) cancelListening();
  pressCancelled = true;
  resetPress();
});

face.addEventListener("contextmenu", (event) => event.preventDefault());
face.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    if (speaking) stopSpeech(); else toggleChat();
  }
});

function scheduleBlink() {
  const delay = 4000 + Math.random() * 5000;
  setTimeout(() => {
    if (!document.hidden && interactionState !== "listening") {
      face.classList.add("blinking");
      setTimeout(() => face.classList.remove("blinking"), 170);
    }
    scheduleBlink();
  }, delay);
}
scheduleBlink();

async function clearLegacyCaches() {
  if (!("caches" in window)) return;
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== "wia-order003-shell-20260807").map((name) => caches.delete(name)));
}
void clearLegacyCaches();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {}));
}

window.addEventListener("pagehide", () => {
  abortChat();
  stopSpeech();
  cancelListening();
});

window.__WIA_INTERACTION_DEBUG__ = {
  version: "WIA_INTERACTION_ORDER_003",
  longPressMs: LONG_PRESS_MS,
  open: () => setChatOpen(true),
  close: () => setChatOpen(false),
  stopSpeech,
  getState: () => ({
    open: app.classList.contains("open"),
    interactionState,
    speaking,
    listening: Boolean(recognition),
    roastMode,
    historyLength: history.length,
  }),
};
