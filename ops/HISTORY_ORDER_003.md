# WiA Order 003 execution history

This file records why transient bootstrap and diagnostic machinery was removed after technical completion. Full immutable detail remains in Git history, Issue #3, workflow runs and `ops/evidence/order-003/`.

## Baseline

Order 003 started from remote workset `WIA-FACE-VOICE-UX-V1_1`. The pre-change Cloudflare deployment/version identity and public-source comparison were captured under `ops/evidence/order-003/baseline/`.

## Materialization detour

An attempted archived-source materialization was incomplete: staging contained chunks `source-000` through `source-005` and `source-007` through `source-010`, but `source-006.b64` was absent. The missing bytes were never fabricated. That path was abandoned and canonical source was implemented directly. The obsolete staging chunks and one-shot materialization workflow are intentionally removed from the active tree after successful deployment.

## Model recovery

The original GLM/Qwen model pair intermittently returned empty visible output. Evidence was preserved in baseline/chat diagnostics. A read-only model-catalog API request was also attempted and returned HTTP 403 for the available token scope; it made no inference call and no billing write. Order 003 then moved to the stable Workers AI pair `@cf/meta/llama-3.1-8b-instruct-fast` and `@cf/meta/llama-3.2-3b-instruct`.

## Technical result

- Deploy source SHA: `1aa291758c86868209767adaf6f636e006593721`.
- Cloudflare deployment ID: `e27744d9-a828-4735-92df-43bcebf5ae4a`.
- Cloudflare version ID: `0b14a8be-6188-46c2-86de-f65196986167`.
- Source check, 18 tests and build: PASS.
- Remote root, health, assets, PWA, identity chat, pushback chat, ambiguity chat and explicit ROAST chat: PASS.
- Billing writes: none. Paid provider: none. Secret output: none.
- Final remote evidence: `ops/evidence/order-003/final/result.json`.

## Remaining gate

`HUMAN_FACE_VOICE_ANDROID_ACCEPTANCE` remains a human/physical acceptance gate. It is not represented as an automated PASS.
