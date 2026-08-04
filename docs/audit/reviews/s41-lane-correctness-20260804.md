# Lane: CORRECTNESS — CMspark main pull (2e7cf2f..79d7420)

**Scope:** shell card UI (#110), cookie copy (#111), Anthropic P1 (#113), FocusBand / skill_install / shell argv / outbound MCP (#114)  
**Diff:** `/tmp/cmspark-review-s41/code.diff`  
**Production touch:** `companion/src/**`, `chrome-extension/src/**` (+ tests inspected)  
**Method:** static inspection of real sources + unit-test spot-check (no source edits). Evidence levels tagged.

---

## Summary

The narrow→broad `downloads_find` path, protocol-aware `probeLlmConnection`, FocusBand ST-4 priority machine, shell card extractors, and win32 argv gates are largely sound and partially well-tested. Correctness blockers/nits cluster around **skill_install `dest_path` honesty**, **config.test empty `base_url` merge**, **POSIX argv spawn edge cases** (`FOO=1`, `~`), and a **shell status glyph vs failed tone desync**.

| Field | Value |
|--------|--------|
| **Status** | **WATCH** (fixable issues; not full REJECT) |
| **Recommendation** | **REQUEST_CHANGES** |

---

## Findings

### F1 — skill_install zip success returns `dest_path` = skills **root**, not installed skill dir

- **Severity:** HIGH  
- **Status:** BLOCK-worthy for agent loops that trust `dest_path`  
- **Evidence:** `[inspected]`

```157:162:companion/src/skills/skill-install.ts
      return {
        ok: true,
        dest_path: root,
        skills_root: root,
        hint_zh: hint,
      }
```

`SkillEngine.importSkillFolder` actually writes to `path.join(this.skillsDir, safeName)` (see `skill-engine.ts` ~845–846). Zip install also omits `name`. Agent sees “installed at `~/.cmspark-agent/skills`” and cannot know the real folder without a separate list.

Directory install is better (`path.join(root, safe)`) but still does not `existsSync` the dest; content install partially checks existsSync and may fall back to `root`.

**Test gap:** `companion/tests/skill-install.test.ts` never asserts `dest_path`, never exercises `zip_path` (stub throws `not implemented`), and uses a stub `skillsDir` ≠ `getUserSkillsRoot()`, so dest honesty is untested.

**Fix:** After import, return actual dest (`…/skills/<safeName>` or `…/<safeName>.md`) + `name` from frontmatter; assert in tests with a real or path-faithful engine.

---

### F2 — config.test: empty override `base_url` wins over stored config (`??` not `||`)

- **Severity:** HIGH  
- **Status:** WATCH → should fix before claiming “test unsaved UI fields”  
- **Evidence:** `[inspected]`

```342:347:companion/src/message-router.ts
      const testConfig = {
        api_key: hasOverrideKey
          ? String(override!.api_key)
          : config.llm.api_key,
        base_url: String(override?.base_url ?? config.llm.base_url),
        model_name: String(override?.model_name ?? config.llm.model_name),
```

Empty string is not nullish. Settings **「Coding Plan 中继」** preset deliberately sets `base_url: ""`:

```818:824:chrome-extension/src/sidepanel/components/SettingsSlideout.tsx
                onClick={() =>
                  dispatch({
                    type: "SET_CONFIG",
                    config: {
                      protocol: "anthropic",
                      client_header_profile: "claude_code_compat",
                      base_url: "",
```

Extension always forwards override object (including empty base_url) after #113:

```662:674:chrome-extension/src/sidepanel/components/SettingsSlideout.tsx
    const llmOverride: Record<string, string> = {
      base_url: config.base_url,
      model_name: config.model_name,
      protocol: ...
    }
```

**User path:** click Coding Plan preset → Test connection without pasting URL → probe gets `base_url=""` → Anthropic path throws / “Base URL 未配置”, even if a working URL was previously saved.

**Fix:** Treat blank override fields as absent:  
`const base = (override?.base_url as string)?.trim(); base_url: base || config.llm.base_url`  
Same for `model_name`. Optionally refuse Save with empty base_url.

---

### F3 — shell argv: env-assignment prefix `FOO=1 cmd` incorrectly takes `spawn_mode: "argv"` on POSIX

- **Severity:** HIGH (behavior change vs pre-P1b shell:true)  
- **Status:** WATCH  
- **Evidence:** `[inspected]`; tests do not cover

```118:163:companion/src/capability/shell.ts
export function tryParseSimpleArgv(command: string): string[] | null {
  ...
  // Rejects $VAR and globs, but NOT leading ENV=value tokens
  ...
  return tokens
}
```

`FOO=1 ls` → `["FOO=1","ls"]` → `shouldUseArgvSpawn` true on non-win32 → `spawn("FOO=1", ["ls"])` → ENOENT / spawn error. Previously `shell:true` ran correctly.

**Related (MEDIUM):** unexpanded `~` — `ls ~` / `cat ~/Downloads/x` → argv mode, literal `~` (no shell expansion). Metachar filter does not treat `~`.

**Tests:** `companion/tests/shell-progress-windowsHide.test.ts` covers quotes, Windows paths, metachar, `$HOME`, globs, win32 bat/cmd/exe — **not** `FOO=1`, `~`, or multi-token env prefixes.

**Fix:** Reject argv when any token matches `/^[A-Za-z_][A-Za-z0-9_]*=/` (or only first token); reject / force shell when unquoted `~` or `~/` appears; add unit cases.

---

### F4 — Shell tool card: non-zero exit shows ✓ glyph while danger border / “failed”

- **Severity:** MEDIUM  
- **Status:** WATCH (UI correctness / user trust)  
- **Evidence:** `[inspected]`

Companion intentionally returns `success: true` with `exit_code !== 0` so the agent can read stdout (`shell.ts` close handler). Extension:

```459:477:chrome-extension/src/sidepanel/components/ChatView.tsx
  const derivedStatus: string =
    tc.status === "running" || tc.status === "success" || tc.status === "error"
      ? tc.status   // tool.result sets success when result.success===true
      : shellCard ? ... shellFailed ? "error" : "success" ...
  const statusGlyph =
    derivedStatus === "running" ? "…" : derivedStatus === "success" ? "✓" : ...
  // border uses shellFailed → danger
```

Live path after `tool.result`: `tc.status === "success"` even when `exit_code=1` → **✓ + red left edge + “exit 1”**. History without status derives error correctly via `shellFailed`.

`extractShellCardData` tests cover failed flag; **no test** for ChatView derivedStatus interaction.

**Fix:** For shell_exec, prefer `shellFailed` over `tc.status` when computing glyph/tone (or set tool.result status from exit_code on companion/extension).

---

### F5 — skill_install content/path dest naming can diverge from gray-matter import

- **Severity:** MEDIUM  
- **Status:** WATCH  
- **Evidence:** `[inspected]`

`extractNameFromMarkdown` uses a line regex on the first frontmatter block; `importSkill` / `importSkillFiles` use `gray-matter`. Names with YAML comments, unusual quoting, or non-string scalars can sanitize differently → `dest_path` points at a non-existent file while install wrote another name (content path falls back to `root` only if `existsSync` fails — softens content case).

Directory path returns `path.join(root, safe)` **without** existsSync.

**Tests** do not assert `r.dest_path` equality with files written under the engine’s real skills dir.

---

### F6 — downloads_find narrow→broad: solid; minor agent-facing edges

- **Severity:** LOW–MEDIUM  
- **Status:** CLEAR for primary claim; WATCH nits  
- **Evidence:** `[inspected]` + tests exist

**Correct:**
- Narrow: `filenameRegex` + no `exists:true` in query; client filter still drops `exists===false`.
- Zero post-filter hits → broad search (limit 100, no regex) + same client filter.
- `detectDownloadConflicts` on full match set before trim; `search_mode` exposed.
- Unit test `runDownloadsFind falls back to broad search when narrow regex misses` covers the Windows/GitHub pain path.

**Nits:**
1. **urlContains-only:** narrow and broad are the same shape (no regex); only limit 50→100. Harmless extra call.
2. **Conflict + limit=1:** `conflict: true` with a single returned match is intentional, but agent may still pick the only listed path; note is OK if model reads `conflict_hint_zh`.
3. **Broad cap 100:** very old downloads beyond top 100 complete items still miss (acceptable tradeoff).

---

### F7 — connection-test protocol probe: correct core; good unit coverage

- **Severity:** LOW (remaining gaps)  
- **Status:** CLEAR for happy paths  
- **Evidence:** `[inspected]` + `companion/tests/llm-connection-test.test.ts`

- OpenAI → `POST …/chat/completions` with headers from `buildRequestHeaders`.
- Anthropic → `resolveAnthropicMessagesUrl` + `/messages` body shape.
- First-party + `claude_code_compat` refused pre-fetch.
- 401/404/400 mapped with protocol-aware copy.

**Gaps (LOW):** no test for empty `base_url` override merge (F2); OpenAI path does not guard double `/chat/completions` if user pastes full completions URL (pre-existing class of base_url footguns).

settings-web and message-router both call the same probe — good for consistency.

---

### F8 — FocusBand / running tools: priority + shared collector look correct

- **Severity:** LOW  
- **Status:** CLEAR  
- **Evidence:** `[inspected]` + tests

Priority: Confirm → L2 → Fleet → **thread_tools** → L1 → empty; `secondaryTools` under confirm/fleet when height allows; abort secondary still beats tools/context under confirm.

`collectRunningTools` newest-first, scan last 40, dedupe by **name** (two concurrent `shell_exec` collapse — rare). Chat footer and FocusBand share the helper — good desync fix vs ST-1 inline scan.

`tool.progress` updates elapsed without clearing running; `tool.result` clears running. Pre-existing risk: lost `tool.result` leaves permanent “执行中” (not introduced here).

---

### F9 — Cookie trust copy / UI hint path

- **Severity:** LOW  
- **Status:** CLEAR  
- **Evidence:** `[inspected]`

`cookieTrustBlockedPayload` adds `error_code: COOKIE_TRUST_DENIED` + `user_hint_zh`; ChatView prefers `data.user_hint_zh` first — aligns extension card with companion message. No logic gate change to trust matching itself.

---

### F10 — Outbound MCP façade: fail-closed skeleton

- **Severity:** LOW (Phase 0)  
- **Status:** CLEAR for “not wired open”  
- **Evidence:** `[inspected]`

`gateOutboundCall` allowlist + disclosure for exfil tools; audits on forbid/allow. No evidence of a full stdio bridge dispatching tools yet — cannot create runtime desync until wired. Confirm future wiring always calls `gateOutboundCall` first.

---

### F11 — skill_install source allowlist edge (correctness of “allowed sources”)

- **Severity:** LOW–MEDIUM  
- **Status:** WATCH  
- **Evidence:** `[inspected]`

`isSkillInstallSourceAllowed` allows any path segment `downloads` / `下载`, plus realpath of config dir and tmp. Realpath on zip/path inputs prevents simple symlink escape out of Downloads. Segment match is intentionally coarse (same pattern as downloads_find).

**Gap:** no `%USERPROFILE%` / `%TEMP%` expansion (Windows agents often pass those); only `~` / `~/`. Failure is fail-closed (reject/not found) — OK, but less usable.

**Tests** cover Downloads under tmp, tmp root, and optional Desktop reject — not zip_path end-to-end, not dest_path.

---

### F12 — Anthropic skill-craft / skill-engine provider routing

- **Severity:** LOW  
- **Status:** CLEAR (directional)  
- **Evidence:** `[inspected]`

Replacing hard-coded OpenAI clients with `llmExtract` / `createProvider` is necessary for Anthropic protocol correctness on craft/match paths. No new state machine bugs spotted; relies on existing provider layer.

---

## Tests vs claims matrix

| Claim | Unit coverage | Verdict |
|--------|----------------|---------|
| downloads_find narrow→broad | Yes (`downloads-find.test.ts`) | **Covers claim** |
| detectDownloadConflicts | Yes | **Covers claim** |
| probe OpenAI/Anthropic/compat refuse | Yes (`llm-connection-test.test.ts`) | **Covers claim** |
| empty base_url override merge | No | **Miss (F2)** |
| tryParseSimpleArgv / win32 bat·cmd | Yes (partial) | **Miss FOO=1 / ~ (F3)** |
| skill_install dest_path honesty | No meaningful assert | **Miss (F1/F5)** |
| skill_install zip_path | Stub not implemented | **Miss** |
| shell card extract / failed on exit≠0 | Yes (`shell-card-utils.test.ts`) | **Covers pure util; not glyph desync (F4)** |
| FocusBand ST-4 priority | Yes (`focus-band-priority.test.ts`) | **Covers claim** |
| collectRunningTools | Yes | **Covers claim** |
| ChatView derivedStatus shell | No | **Miss (F4)** |

---

## Positive notes (correctness)

1. **win32 argv gate** only `.exe`/`.com` — avoids Node EINVAL on `.bat`/`.cmd` and bare shims (`npm`) — well documented and tested.  
2. **Windows path backslashes** inside quotes not eaten as escapes — correct B2 fix.  
3. **downloads_find** removing `exists:true` from Chrome query matches known flaky settlement behavior.  
4. **config.test** now protocol-aware (was models.list OpenAI-only) — large correctness win for Anthropic users.  
5. **Shell card** shows command + stdout/stderr plain text; live progress still gated on `running`.  
6. **skill_install** fail-closed on missing params, non-zip, oversized zip/dir, disallowed paths.

---

## Recommendation

**REQUEST_CHANGES**

Must-fix before treating agent install + connection-test UX as correct:

1. **F1** — Honest `dest_path` (+ `name`) for zip (and verify dir/file).  
2. **F2** — Empty-string override fields must not clobber stored base_url/model on `config.test` (and preferably Save).  
3. **F3** — Do not argv-spawn env-assignment prefixes; prefer shell or reject; consider `~`.  

Should-fix / nits: **F4** glyph vs failed, **F5** dest verify, expand skill_install/zip tests.

**Lane status:** **WATCH** (merge only after F1–F3 or explicit risk accept).

---

*Correctness lane — S41 main pull review*  
*Evidence mostly `[inspected]`; tests read as source of coverage claims.*
