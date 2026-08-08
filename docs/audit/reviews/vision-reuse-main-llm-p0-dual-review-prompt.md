# Dual external review — vision-reuse-main-llm P0

## Capability declaration (ADR-020)

```text
Surface:      L0 (settings UX)
L2-classes:   (none)
Compose:      existing vision side-pipeline (config.vision → analyzeImage);
              reuse may bind vision endpoint to main LLM after explicit opt-in
Autonomy:     single
Trust:        HITL gates unchanged; privacy: screenshots go to vision.base_url (hostname disclosed)
Channel:      community
```

## Blast tier: T2

## Prior multi-adversarial (design)

Read: `docs/audit/reviews/vision-reuse-main-llm-adversary-synthesis-20260808.md`  
Brief: `docs/decisions/vision-reuse-main-llm-brief-2026-08-08.md`

Locked: Anthropic protocol hard-blocks reuse; server key inherit when endpoints match; fail-closed non-loopback+placeholder key; hostname disclosure; no IMAGE_FETCH/tool changes; no new schema fields.

## Scope of this implementation

- `chrome-extension/src/sidepanel/components/vision-reuse-logic.ts` + tests
- `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` vision section UX
- `companion/src/llm/vision-reuse-inherit.ts` + tests
- `companion/src/config.ts` saveConfig inherit
- `companion/src/llm/vision-pipeline.ts` fail-closed before POST
- `companion/src/settings-web.ts` honesty help text
- `companion/tests/config.test.ts` inherit integration

## DoD checklist (verify with tools)

1. Pure multimodal/reuse helpers unit-tested; fail closed on unknown; anthropic hard-block
2. Companion inherits llm key when vision url+model match + placeholder vision key
3. vision-pipeline does not POST image to non-loopback with ollama/empty key
4. Settings copy: no “需要 Ollama 等本地推理服务”; states pre-analyze→text; hostname on reuse
5. Reuse only on explicit button, not bare checkbox
6. No analyze_image / IMAGE_FETCH / tool definition changes
7. No new config schema fields

## Machine evidence (implementer)

- extension: `node --test .test-dist/tests/vision-reuse-logic.test.js` → 12 pass
- companion: `node --test .test-dist/tests/vision-reuse-inherit.test.js` → 6 pass
- companion: config.test vision inherit suite → 2 pass

## Review tasks

1. Read the diff against base; confirm DoD with file:line evidence.
2. Hunt residual: silent key overwrite, Anthropic false offer, missing host disclosure, dark pattern.
3. Score outcome / trajectory / component.
4. Final line MUST be exactly one of:
   VERDICT: APPROVE
   VERDICT: APPROVE_WITH_NITS
   VERDICT: REJECT
