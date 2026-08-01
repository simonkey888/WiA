# WiA V1.1 operational policy

- Workset: `WIA-FACE-VOICE-UX-V1_1`
- Marker: `WIA_FACE_VOICE_UX_V1_1`
- Production Worker: existing `wia` only.
- Direct edits to `main`: forbidden.
- External or paid TTS: forbidden without explicit authorization.
- Chat limits: 600 characters, 8 history messages, 180 output tokens.
- Inference: one primary call; one fallback call only after invocation failure, empty output or unrecoverable output.
- Reactions: neutral, warm, amused, curious, skeptical, surprised, concerned.
- Cloudflare Rate Limiting binding is enforced before inference.
- `ops/EVENTS.ndjson` is append-only.
