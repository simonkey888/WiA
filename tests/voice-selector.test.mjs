import test from "node:test";
import assert from "node:assert/strict";
import { chooseVoice, scoreVoice, VOICE_SELECTOR_VERSION, VOICE_PRESETS, ACTIVE_PRESET } from "../public/voice-selector.js";

const voice = (name, lang, localService = false, isDefault = false) => ({ name, lang, localService, default: isDefault, voiceURI: `${name}:${lang}` });

test("selector version and three physical-test presets are explicit", () => {
  assert.equal(VOICE_SELECTOR_VERSION, "WIA_LATAM_VOICE_SELECTOR_ORDER_003");
  assert.equal(VOICE_PRESETS.length, 3);
  assert.equal(ACTIVE_PRESET.id, "balanced");
  assert.ok(ACTIVE_PRESET.rate >= 0.94 && ACTIVE_PRESET.rate <= 0.98);
  assert.ok(ACTIVE_PRESET.pitch >= 1.00 && ACTIVE_PRESET.pitch <= 1.06);
});

test("es-ES never beats a viable preferred LATAM voice", () => {
  const voices = [
    voice("Microsoft Helena", "es-ES", false, true),
    voice("Google español latinoamericano", "es-419", false, false),
    voice("Sabina Premium", "es-MX", false, false),
  ];
  const selected = chooseVoice(voices);
  assert.equal(selected.voice.lang, "es-419");
});

test("quality terms and explicit allowlist improve deterministic score", () => {
  assert.ok(scoreVoice(voice("Sabina Neural", "es-MX")) > scoreVoice(voice("Pico Robot", "es-MX")));
});

test("fallback to es-ES exists only when no Latin alternative exists", () => {
  const selected = chooseVoice([voice("Helena", "es-ES")]);
  assert.equal(selected.voice.lang, "es-ES");
});
