export const VOICE_SELECTOR_VERSION = "WIA_LATAM_VOICE_SELECTOR_V1_1";
export const LATAM_LANG_PRIORITY = Object.freeze(["es-419", "es-MX", "es-US", "es-AR", "es-CO", "es-CL", "es-PE"]);
export const QUALITY_TERMS = Object.freeze(["natural", "neural", "premium", "enhanced", "studio", "wavenet", "online"]);
export const LOW_QUALITY_TERMS = Object.freeze(["compact", "espeak", "pico", "robot", "classic", "legacy"]);
export const FEMALE_ALLOWLIST = Object.freeze([
  "paulina", "sabina", "ximena", "dalia", "mía", "mia", "sofia", "sofía", "elvira", "helena", "luciana", "valentina",
  "google español de estados unidos", "google español latinoamericano"
]);
export const VOICE_PRESETS = Object.freeze([
  Object.freeze({ id: "calm", rate: 0.94, pitch: 1.00, volume: 1 }),
  Object.freeze({ id: "balanced", rate: 0.96, pitch: 1.03, volume: 1 }),
  Object.freeze({ id: "bright", rate: 0.98, pitch: 1.05, volume: 1 }),
]);
export const ACTIVE_PRESET = VOICE_PRESETS[1];

function languageScore(language) {
  const lang = String(language || "").replace("_", "-");
  const exactIndex = LATAM_LANG_PRIORITY.findIndex((candidate) => candidate.toLowerCase() === lang.toLowerCase());
  if (exactIndex >= 0) return 1000 - exactIndex * 70;
  if (/^es-(419|mx|us|ar|co|cl|pe|uy|py|bo|ec|ve|cr|pa|gt|hn|sv|ni|do|pr|cu)$/i.test(lang)) return 480;
  if (/^es-/i.test(lang) && !/^es-es$/i.test(lang)) return 300;
  if (/^es-es$/i.test(lang)) return 40;
  if (/^es$/i.test(lang)) return 180;
  return -1000;
}

export function scoreVoice(voice) {
  const name = String(voice?.name || "").toLowerCase();
  let score = languageScore(voice?.lang);
  for (const term of QUALITY_TERMS) if (name.includes(term)) score += 55;
  for (const term of LOW_QUALITY_TERMS) if (name.includes(term)) score -= 180;
  if (FEMALE_ALLOWLIST.some((term) => name.includes(term))) score += 42;
  if (voice?.localService === false) score += 18;
  if (voice?.default) score += 4;
  return score;
}

export function chooseVoice(voices) {
  return [...voices]
    .filter((voice) => /^es(?:-|$)/i.test(String(voice?.lang || "")))
    .map((voice, index) => ({ voice, index, score: scoreVoice(voice) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0] || null;
}
