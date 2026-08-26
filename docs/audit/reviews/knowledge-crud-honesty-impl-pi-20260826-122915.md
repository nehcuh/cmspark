All verification complete. Here's my independent review.

## Review: knowledge-crud-honesty-impl

**Patch freshness**: byte-identical to `git diff --staged` (md5 match, base `a64744b` = HEAD). Not stale.

### Must-answer results

1. **Overlay allowlists exclude get/update/export** — YES, verified at both layers plus tests. `SUMMONER_ALLOW` (`companion/src/ws/summoner-acl.ts:41-42`) and `SUMMONER_WEB_DISPATCH_ALLOW` (`companion/src/summoner-web.ts:36-37`) still hold only `knowledge.list` + `knowledge.set_active`; tests lock `has(...)===false` (`summoner-acl.test.ts:31-34`, `summoner-web.test.ts:414-416`); router extra-denies (`handlers/knowledge.ts:9-12`, `message-router.ts:2781-2784`). I also traced the summoner-web HTTP path end-to-end: it re-dispatches via a dedicated WS client with handshake `surface: "summoner"` (`menu-bar-agent.ts:1860-1865` → lifecycle `stampCmsparkSurface` at `ws/lifecycle.ts:1053`), so the router's `stampedSurface === "summoner"` check genuinely strips `related` from the overlay list — the locked "overlay list 剥 related" holds in production, not just in the mock test.
2. **CJK title update keeps id** — YES. `updateKnowledge` writes in-place to the same `skill.source_file` with `data.id = ident` (`skill-engine.ts:1442-1463`); test `updateKnowledge: CJK title change keeps id and filenameStem` + `does not allocate notes-2` both pass.
3. **exportSkill ⇄ exportKnowledge cross-rejection** — YES. `skill-engine.ts:897` rejects knowledge ids from `exportSkill`; `exportKnowledge` rejects skills (`:1483-1485`); tested.
4. **Get body is raw (editor), not model-injected** — YES. `getKnowledge` has exactly one caller, the handler (`handlers/knowledge.ts:41`); the injection path uses the private `getKnowledgeSummary` (`skill-engine.ts:770`). No path from the new verb into model context.
5. **XSS** — NONE. No `dangerouslySetInnerHTML` anywhere in the panel; body renders in `<pre>`/`<textarea>` only.
6. **Diff scope** — clean. All 10 modified/new code files are knowledge CRUD + its relay/validate/ACL/tests plus README copy and the review-doc family. No drive-bys.

### Rejection gates R1–R7: none triggered
R1 (ACL growth) no; R2 (graph/vault-write) no — export is read-only `fs.readFileSync` + Blob; R3 (id reallocation) no — in-place write, `importKnowledge`/`allocateDocIdentity` never touched; R4 (HTML sink) no; R5 (vault write on export) no; R6 (false code claims) no — every claim I re-checked holds, including the folded adversary blocks (README copy clean of 图谱/双链, legacy `name` preserved in `updateKnowledge`, router-level `user_gesture` belts in both `handleKnowledgeCrud` and `knowledge.delete`); R7 (empty shell) no — reader + `knowledge.get` ship together.

### ADR-020 checklist
Declaration present and accurate (L0 Surface / no L2 / Compose on existing knowledge markdown + SkillEngine / Autonomy n/a / Trust no elevation / Channel unchanged). New verbs are WS-only, Side-Panel-only, double-gated off overlay (HTTP allowlist + connection-surface stamping + router extra-deny). No new primary chrome/tab/runtime; `user_gesture` follows the existing import pattern (no `securityConfirmations.request`, originWs N/A). Passes.

### Machine re-runs
- companion `tsc -p tsconfig.test.json`: OK
- targeted `node --test` (knowledge-crud, knowledge-crud-ws, knowledge-related, summoner-acl, summoner-web, files.test, lockstep): **130/130 pass** (lockstep 4/4)
- chrome-extension `tsc --noEmit`: OK; `npm test`: **819/819 pass**
- Full companion suite: 3582/3620 — the 15 failures are all in `computer-executor`/`computer-uia-watch`/`allow-dir-expand` (L2 computer module, untouched by this diff; env-dependent). Not a false-green: the prompt only claimed the targeted set, which I confirmed.

### Nits (non-blocking)
1. `chrome-extension/src/background/index.ts` `knowledge.delete` relay still maps `message.id || message.name` — a dead fallback since the WS protocol and router both reject name-only and no caller sends it; harmless but contradicts the "delete 不再接受 name" fold in spirit.
2. `getKnowledge` truncation cuts `Buffer.subarray(512KiB)` mid-codepoint for CJK bodies (`skill-engine.ts:1419-1420`) → possible U+FFFD at boundary; lossy-by-design, reader shows the truncated hint.
3. Reader sheet is a hand-rolled fixed-position dialog rather than the existing `Modal` component (adversary nit) — functionally matches F-UX-SHEET-1, cosmetically divergent.
4. Last-write-wins without if-match on update — acknowledged as open in spec §7; UI confirm mitigates.

All three initial adversary BLOCKs are verifiably folded with tests. Locked spec fully implemented; no capability or trust regression.

VERDICT: APPROVE_WITH_NITS
