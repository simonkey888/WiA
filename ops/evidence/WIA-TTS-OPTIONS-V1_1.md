# WiA TTS options V1.1

Evaluación fechada 2026-07-31. Ninguna opción neural fue activada en este workset.

| Opción | Calidad esperable | Español latino | Latencia | Costo / facturación | Infraestructura | Privacidad | Móvil | Decisión V1.1 |
|---|---|---|---|---|---|---|---|---|
| Web Speech API (`speechSynthesis`) | Variable según dispositivo y voz instalada/remota | Depende del inventario del navegador | Baja | Sin proveedor adicional contratado | Ninguna | Texto procesado por la implementación de voz que exponga el navegador/SO | Nativa en Chrome Android, con inventario variable | **Implementada ahora**, con selector determinista y fallback limpio |
| Cloudflare Workers AI `@cf/deepgram/aura-2-es` | Neural, orientada a TTS expresivo | Sí, modelo español | Compatible con proxy Worker; debe medirse | Workers AI publica cobro por caracteres/modelo; requiere control de cuota y autorización de costo | Worker existente | El texto pasa por Cloudflare/Deepgram | Sí, audio servido por Worker | **No activar sin autorización explícita de costo** |
| Google Cloud Text-to-Speech | Neural/Gemini según voz | Sí, sujeto al catálogo | Adecuada para conversación si región/red responden | Facturación por caracteres; la documentación exige habilitar billing | Proyecto Google Cloud y secreto en servidor | Texto enviado a Google Cloud | Sí, vía Worker proxy | No incorporar en V1.1 |
| Azure AI Speech | Voces neural/neural HD | Sí, sujeto al catálogo | Adecuada para tiempo real | Tiene nivel gratuito y cobro por caracteres según nivel; requiere cuenta/credencial | Recurso Azure y secreto en servidor | Texto enviado a Azure | Sí, vía Worker proxy | No incorporar en V1.1 |
| Voicebox autohospedado | Potencialmente alta, depende del modelo/hardware | Debe probarse por modelo | Variable; normalmente mayor sin GPU dedicada | Software local, pero requiere máquina/servidor encendido | PC/GPU o servidor permanente | Puede mantenerse bajo control propio | El móvil consume audio remoto | Sólo opción separada; no producción V1.1 |

## Recomendación

Mantener `speechSynthesis` para V1.1 porque no agrega facturación ni secretos y permite validar primero composición, interacción y selector de voz. La naturalidad no se considera aprobada hasta la escucha física de Simón. Si sigue siendo insuficiente, el siguiente experimento controlado debe comparar una muestra corta de `aura-2-es` contra la mejor voz del dispositivo, con límite de costo explícito y sin activación permanente.

## Fuentes oficiales consultadas

- MDN, `SpeechSynthesis.getVoices()` y evento `voiceschanged`: https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/getVoices y https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event
- Cloudflare Workers AI, modelo Aura 2 español y pricing: https://developers.cloudflare.com/workers-ai/models/aura-2-es/ y https://developers.cloudflare.com/workers-ai/platform/pricing/
- Google Cloud Text-to-Speech pricing: https://cloud.google.com/text-to-speech/pricing?hl=es-419
- Azure AI Speech pricing: https://azure.microsoft.com/es-mx/pricing/details/speech/
