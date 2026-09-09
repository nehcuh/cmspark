# Independent re-review — 0.6.7 honesty implementation

**Reviewer**: grok (did not write this patch)  
**Mode**: READ-ONLY live-file spot-check. Tried to REJECT.  
**Evidence**: `[inspected]` unless marked otherwise. Tests / live INSTDIR / NSIS compile **not** re-executed.

Mandate: `docs/audit/reviews/_prompts/s107-impl-review-20260908.md`. Frozen: do **not** demand #230 overlay Allow/Deny or expanding default outbound L1.

---

## Item-by-item (must-verify)

### 1. Lockstep 0.6.7 — PASS

| Artifact | Version | Cite |
|----------|---------|------|
| `companion/package.json` | **0.6.7** | L3 |
| `chrome-extension/package.json` | **0.6.7** | L4 |
| `companion/package-lock.json` | **0.6.7** | L3, L9 (`packages[""]`) |
| `chrome-extension/package-lock.json` | **0.6.7** | L3, L9 (deeper 0.6.x hits are transitive deps) |
| `scripts/installer.nsi` fallback | **0.6.7** | L13–14 `!ifndef PRODUCT_VERSION` |
| `AGENTS.md` header + footer | **0.6.7** | L3, L69 |
| ACP `clientInfo` | **0.6.7** | `companion/src/acp/jsonrpc-stdio.ts:164` |
| outbound `serverInfo` | **0.6.7** | `companion/src/outbound-mcp/stdio-server.ts:252` |
| `CLI_VERSION_FALLBACK` | **0.6.7** | `companion/src/cli-version.ts:5` |

### 2. README knowledge inject + Capture default — PASS

- Capture default **1040×760**, compact **360×420**: README L16, L53, L215–226, L987. Code `OVERLAY_WINDOW_SIZE = { w: 1040, h: 760 }` at `companion/src/summoner/shell-open.ts:29`. PRODUCT L3 matches.
- Knowledge default is **TF-IDF top-k**, not 灌库: README L59, L337, L367–372. Auto `KNOWLEDGE_DOC_TOPK_AUTO=5`, all `KNOWLEDGE_DOC_TOPK_ALL=8`, budget 8000. Code `skill-engine.ts:80–84,1472–1473` slices even `all` under smart-match. 「灌库」survives only as the **legacy** sentence when smart matching is off (README L372) — that path exists (`legacyResolve` at `skill-engine.ts:1448–1457`). Default claim is honest.

### 3. PRODUCT remaining — PASS

`PRODUCT.md:5`: remaining is **#230 freeze** + **#228 scored / do not expand**. Hex PTT / Windows SAPI / speaker embedding exist; embedding stays experimental. **#258–#260 are not remaining.** Living user docs (README L987, CLAUDE.md L21/L37, GOAL.md L3) match.

### 4. Host close copy + unmount `meeting.end` — PASS

`ContextPanelHost.tsx:277–307`: `closeEndsMeeting = activePanel === "meeting" && meetingCaptureActive`. When true, button text / `title` / `aria-label` are **「结束并收起」**; otherwise still 「收起」. Click still `closePanel()` only.

`MeetingPanel.tsx:600–613`: unmount effect **still** sends `{ type: "meeting.end", v: 1, id }` when `phaseRef.current !== "idle" && !finalizedRef.current`, with `finalizedRef` guard. Comment documents anti-stuck `status=recording`. Dual-review nit honored (relabel Host, do not delete unmount end).

### 5. User-visible 「设置 → 听写」 gone — PASS (with NIT, see below)

Zero matches for `设置 → 听写` / `设置 › 听写` in `*.ts` / `*.tsx`. Live recovery copy:

- MeetingPanel L506 / L768 / L936 / L1271 / L1303 / L1583 → **设置 → 输入与语音** (item **听写方式** kept where it is a control name)
- `meeting-diarize-copy.ts:24` → `设置 → 输入与语音 → 听写方式`
- `summoner-web.ts:1749` `STT_NEED_MODEL` → `侧栏 ⋯ → 设置 → 输入与语音 → 下载组件/模型`
- `diarize-embed.ts:99` same family
- Settings chrome: `SettingsPage.tsx:7` page title **输入与语音**, description includes 听写方式 as an item — allowed.

Historical specs/plans/audit notes still quote the old string; those are not user-visible chrome.

### 6. CLI `--version` / `status` / `stop` — PASS

`companion/src/index.ts`:

- L476–480: `--version` / `-V` / `version` → `console.log(cmspark-agent v${resolveCliVersion()})` + `process.exit(0)`
- L336–342: `stop` → `handleDaemonStop()`; `status` → `handleDaemonStatus()` (same as `daemon stop` / `daemon status`)
- `handleDaemonStop` L202–263 actually SIGTERM/SIGKILL + pid/lock cleanup
- `handleDaemonStatus` L265–281 prints lock/pid/process (and WS when running)
- No `not yet implemented` / `未实现` in `index.ts`
- Usage banner L35–38 documents the aliases
- Test covers `--version` exit 0 (`companion/tests/cli-version.test.ts:37–47`); `-V` / `version` / `status` / `stop` are source-true, not spawn-tested

### 7. `persistAssistantDraft` redacts tool_calls — PASS

`adapter.ts:46` imports `redactAssistantToolCallsForPersistence`.  
`persistAssistantDraft` L1178: `tool_calls: redactAssistantToolCallsForPersistence(assistantMsg)` **before** `addMessage` L1188.  
`tool-persistence-redact.ts:284–303`: clones; invalid JSON becomes `{ _redacted: "invalid_json", len }` — never stores raw. Other `addMessage` sites in adapter are user / steer / tool-result / leak-hint rows, not assistant `tool_calls`. Tests: `companion/tests/assistant-tool-args-redact.test.ts`.

### 8. CHANGELOG `[0.6.7]` + empty Unreleased — PASS

```
## [Unreleased]

## [0.6.7] — 2026-09-08
```

`CHANGELOG.md:5` Unreleased has **no bullets**. Honesty wave + previously-Unreleased workspace/enterprise slices live under `[0.6.7]` L7–40. Date 2026-09-08.

### 9. Frozen scope — PASS (did not demand)

- Overlay still **never** Allow/Deny (`PRODUCT.md:36,57`; README Capture row).
- Default outbound still **8** tools, byte-identical allowlist (`profile.ts:21–30,60–61`). Interact / `outbound_context_v1` remain named profiles. README/CLAUDE/PRODUCT/GOAL all repeat **禁扩** #228.
- Official Windows payload is **not** SEA: `installer.nsi:8` “MUST be package.sh staging (`node.exe` + `cmspark-agent.js`)”; L89 deletes leftover `cmspark-agent.exe`; `build-windows-exe.ps1:603,610` SEA zip only, Setup.exe is `package.sh`.

---

## REJECT criteria

| Trigger | Result |
|---------|--------|
| Any P0 pin false | **none** |
| SEA as official Setup payload | **not tripped** `[inspected]` nsi + ps1 comments/paths |
| Default outbound expanded | **not tripped** — still 8 tools |
| Docs still sell **0.6.0 as live cut** | **not tripped**. Living banners: README L987, PRODUCT L4, CLAUDE L37/L137, `docs/README.md` L3/L49/L175, GOAL L3/L11, architecture L3, summoner / meeting / CU / host guides, `companion/README.txt` L1 — all **0.6.7**. Remaining `0.6.0` hits are historical CHANGELOG index citations. |

Did not execute: test suites, live INSTDIR/ARP/23401, PTY Darwin path, SEC A–N. Those stay on S107 six-lane `[executed]` records.

---

## NIT (non-blocking)

1. **Incomplete recovery-copy sweep in the same MeetingPanel file.** L512 / L772 still say 「请到设置 → 语音 下载模型…」. That is not the P0 string 「设置 → 听写」, and Settings has no page titled 「语音」— the page is 「输入与语音」 (`SettingsPage.tsx:7`). Same recovery-path family the patch touched. Align to 「设置 → 输入与语音」 (item 听写方式 optional). Fixture `meeting-diarize-upload.test.ts:158` 「设置 → 语音模型」 is test-only.

2. **Agent/contrib leftover vs PRODUCT remaining.** `AGENTS.md:29` and `CONTRIBUTING.md:116` still list **#258–#260 语音/会议** as 本季余项. PRODUCT + CLAUDE dropped them. Pin 3 is PRODUCT-only and holds; these two files were outside L1 mutex except AGENTS version lines. Follow-up one-liner, not a user-facing live-cut lie.

3. **No Host-header regression test.** `sheet-family-pr5.test.ts` still only asserts MeetingPanel’s own 「结束并收起」 (#342). `closeEndsMeeting` in ContextPanelHost is untested. Pre-existing gap; behavior is visible in source.

4. **CLI test coverage thinner than the pin.** `cli-version.test.ts` spawn-checks `--version` only. `-V` / `version` / `status` / `stop` are `[inspected]` in `index.ts`, not `[executed]`.

5. **README L372 vs empty-query legacy.** Docs say 关掉智能匹配才退回旧行为. Code also `legacyResolve()` when `smartMatch && !query` (`skill-engine.ts:1460`). Default path **with a question** is still TF-IDF top-k. Precision nit, not the old 全选灌库 P0.

---

## BLOCK

None.

VERDICT: APPROVE_WITH_NITS
