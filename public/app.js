const app = document.getElementById("app");
const face = document.getElementById("face");
const panel = document.getElementById("panel");
const form = document.getElementById("form");
const input = document.getElementById("input");
const messages = document.getElementById("messages");
const statusEl = document.getElementById("status");

const HOLD_DELAY_MS = 380;
let holdTimer = 0;
let longPressStarted = false;
let pointerId = null;
let recognition = null;
let history = [];
let isSending = false;
let blinkTimer = 0;
let activeUtterance = null;

function setFaceState(name, enabled) {
  face.classList.toggle(name, Boolean(enabled));
}

function setOpen(open) {
  app.classList.toggle("open", open);
  panel.toggleAttribute("inert", !open);
  panel.setAttribute("aria-hidden", String(!open));
  if (open) {
    requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight;
      setTimeout(() => messages.scrollTop = messages.scrollHeight, 80);
    });
  }
}

function toggleChat() {
  setOpen(!app.classList.contains("open"));
}

function updateVisualHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--visual-height", `${Math.round(height)}px`);
  if (app.classList.contains("open")) {
    requestAnimationFrame(() => {
      messages.scrollTop = messages.scrollHeight;
    });
  }
}

window.visualViewport?.addEventListener("resize", updateVisualHeight);
window.visualViewport?.addEventListener("scroll", updateVisualHeight);
window.addEventListener("resize", updateVisualHeight);
updateVisualHeight();

function scheduleBlink() {
  clearTimeout(blinkTimer);
  const delay = 4000 + Math.random() * 5000;
  blinkTimer = window.setTimeout(() => {
    if (!face.classList.contains("listening")) {
      setFaceState("blinking", true);
      window.setTimeout(() => setFaceState("blinking", false), 210);
    }
    scheduleBlink();
  }, delay);
}
scheduleBlink();

function addMessage(role, text) {
  const element = document.createElement("div");
  element.className = `msg ${role === "user" ? "user" : "wia"}`;
  element.textContent = text;
  messages.append(element);
  messages.scrollTop = messages.scrollHeight;
  history.push({
    role: role === "user" ? "user" : "assistant",
    content: text,
  });
  history = history.slice(-12);
}

function resizeComposer() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 112)}px`;
}
input.addEventListener("input", resizeComposer);

function getSpanishVoice() {
  const voices = speechSynthesis.getVoices();
  const exactOrder = ["es-419", "es-MX", "es-US", "es-AR"];
  for (const language of exactOrder) {
    const voice = voices.find((candidate) => candidate.lang.toLowerCase() === language.toLowerCase());
    if (voice) return voice;
  }
  return voices.find((voice) => voice.lang.toLowerCase().startsWith("es-")) || null;
}

function stopSpeaking() {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  activeUtterance = null;
  setFaceState("speaking", false);
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  stopSpeaking();

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = getSpanishVoice();
  utterance.voice = voice;
  utterance.lang = voice?.lang || "es-419";
  utterance.rate = 0.97;
  utterance.pitch = 1.02;
  utterance.onstart = () => setFaceState("speaking", true);
  utterance.onend = () => {
    activeUtterance = null;
    setFaceState("speaking", false);
  };
  utterance.onerror = () => {
    activeUtterance = null;
    setFaceState("speaking", false);
  };
  activeUtterance = utterance;
  speechSynthesis.speak(utterance);
}

if ("speechSynthesis" in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.("voiceschanged", () => speechSynthesis.getVoices(), { once: true });
}

async function send(text) {
  const message = text.trim();
  if (!message || isSending) return;

  isSending = true;
  setOpen(true);
  addMessage("user", message);
  input.value = "";
  resizeComposer();
  input.disabled = true;
  form.querySelector("button").disabled = true;
  statusEl.textContent = "Pensando…";
  setFaceState("thinking", true);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        message,
        history: history.slice(0, -1),
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok || typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error(data.error || "No respondió");
    }
    addMessage("assistant", data.reply);
    statusEl.textContent = data.model || "";
    speak(data.reply);
  } catch (error) {
    statusEl.textContent = `Error: ${error.message}`;
  } finally {
    isSending = false;
    setFaceState("thinking", false);
    input.disabled = false;
    form.querySelector("button").disabled = false;
    input.focus({ preventScroll: true });
    messages.scrollTop = messages.scrollHeight;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  send(input.value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

function createRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const instance = new SpeechRecognition();
  instance.lang = "es-AR";
  instance.interimResults = false;
  instance.continuous = false;
  instance.maxAlternatives = 1;

  instance.onstart = () => {
    setFaceState("listening", true);
    statusEl.textContent = "Te escucho…";
  };
  instance.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript?.trim();
    if (transcript) send(transcript);
  };
  instance.onerror = (event) => {
    if (event.error !== "aborted" && event.error !== "no-speech") {
      setOpen(true);
      statusEl.textContent = `Micrófono: ${event.error}`;
    }
  };
  instance.onend = () => {
    setFaceState("listening", false);
    recognition = null;
  };
  return instance;
}

function beginHoldToTalk() {
  longPressStarted = true;
  stopSpeaking();
  recognition = createRecognition();
  if (!recognition) {
    setOpen(true);
    statusEl.textContent = "El dictado no está disponible en este navegador";
    return;
  }
  try {
    recognition.start();
  } catch {
    recognition = null;
    setFaceState("listening", false);
  }
}

function finishPointerInteraction(cancelled = false) {
  clearTimeout(holdTimer);
  holdTimer = 0;

  if (longPressStarted) {
    if (recognition) {
      try {
        cancelled ? recognition.abort() : recognition.stop();
      } catch {}
    }
  } else if (!cancelled) {
    if (face.classList.contains("speaking")) stopSpeaking();
    else toggleChat();
  }

  longPressStarted = false;
  pointerId = null;
}

face.addEventListener("pointerdown", (event) => {
  if (pointerId !== null) return;
  pointerId = event.pointerId;
  longPressStarted = false;
  face.setPointerCapture?.(event.pointerId);
  holdTimer = window.setTimeout(beginHoldToTalk, HOLD_DELAY_MS);
});

face.addEventListener("pointerup", (event) => {
  if (event.pointerId !== pointerId) return;
  finishPointerInteraction(false);
});

face.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== pointerId) return;
  finishPointerInteraction(true);
});

face.addEventListener("lostpointercapture", () => {
  if (pointerId !== null) finishPointerInteraction(true);
});

face.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleChat();
  }
});

navigator.serviceWorker?.register("/sw.js").catch(() => {});
