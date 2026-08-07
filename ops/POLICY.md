# WiA Order 003 operational policy

- Workset: `WIA-COMPLETE-END-TO-END-V1`.
- Marker: `WIA_COMPLETE_END_TO_END_V1`.
- Production Worker: existing `wia` only.
- Canonical URL: `https://wia.simondalmasso44.workers.dev/`.
- Direct edits to `main`: forbidden; changes land through a reviewed branch/PR.
- Zero-cost is absolute: no billing writes and no paid external inference or TTS provider.
- Cloudflare Workers AI only; current primary `@cf/meta/llama-3.1-8b-instruct-fast`, fallback `@cf/meta/llama-3.2-3b-instruct`.
- Chat limits: 600 characters, 8 history messages, 220 output tokens; bounded model retries only.
- Cloudflare Rate Limiting binding is enforced before inference.
- ROAST MODE defaults OFF and activates only by explicit per-session user opt-in; no hidden or persistent activation.
- Reactions: neutral, warm, amused, curious, skeptical, surprised, concerned.
- Mobile web/Android 360x800 is the primary product surface; desktop keeps the same centered mobile composition.
- Face and voice technical gates may pass automatically, but human physical Android acceptance cannot be inferred or self-certified.
- `ops/EVENTS.ndjson` is append-only; evidence under `ops/evidence/` is preserved.
