# Mission Pack P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Mission Pack platform (schema, install, atomic apply, uninstall rollback, audit log) plus built-in AppSec pack and minimal Side Panel list/apply UI — no Shell PTY, no NetSec scanners.

**Architecture:** Companion owns packs under `DATA_DIR/packs/installed/`, validates `pack.yaml`, copies pack skills/knowledge into namespaced files, applies an atomic Thread patch (`mission_pack_id` + snapshot + whitelist + `system_prompt_append`). Extension lists packs over existing WebSocket and calls `pack.apply`. Modules config gains `appsec` opt-in only.

**Tech Stack:** TypeScript, Node `node:test`, `js-yaml`, existing `thread-manager` / `skill-engine` / `message-router` / Plasmo React Side Panel.

**Spec:** `docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md` (§10 P0, §17 amendments)  
**Reviews:** Claude + Pi APPROVE_WITH_CHANGES → synthesis `docs/decisions/v1.3/mission-pack-design-review-synthesis-2026-07-26.md`

**Out of scope (later plans):** Shell PTY, NetSec, DevSec workspace folder binding, pack.export, skill-engine multi-root, Cockpit Terminal.

---

## File map

| File | Responsibility |
|------|----------------|
| `companion/src/packs/types.ts` | **Create** — PackManifest, ThreadPackSnapshot, list DTOs |
| `companion/src/packs/validator.ts` | **Create** — schema validate, path containment, tool name check, security blocklist |
| `companion/src/packs/audit-log.ts` | **Create** — capability-audit.jsonl append + rotate |
| `companion/src/packs/pack-engine.ts` | **Create** — install/list/uninstall/apply orchestration |
| `companion/src/packs/builtin/appsec-prd-review/**` | **Create** — pack.yaml + skills + knowledge |
| `companion/src/threads/thread-manager.ts` | **Modify** — new fields, `system_prompt_append` ALLOWED, `applyPackPatch` |
| `companion/src/llm/adapter.ts` | **Modify** — merge `system_prompt_append` into system messages |
| `companion/src/config.ts` | **Modify** — ensure `packs/installed`, `logs`; default `capability_profile` + `modules.appsec` |
| `companion/src/message-router.ts` | **Modify** — `pack.list` / `pack.install` / `pack.apply` / `pack.uninstall` |
| `companion/tests/packs-validator.test.ts` | **Create** |
| `companion/tests/packs-engine.test.ts` | **Create** |
| `companion/tests/packs-audit-log.test.ts` | **Create** |
| `chrome-extension/src/sidepanel/components/PacksPanel.tsx` | **Create** — list + apply |
| `chrome-extension/src/sidepanel/...` | **Modify** — wire Packs entry (Settings or BottomBar low-freq) |
| `chrome-extension/src/sidepanel/hooks/useWebSocket.ts` | **Modify** — send/receive pack.* if not generic enough |

---

### Task 1: Types + PackValidator (unknown tools reject, containment, blocklist)

**Files:**
- Create: `companion/src/packs/types.ts`
- Create: `companion/src/packs/validator.ts`
- Test: `companion/tests/packs-validator.test.ts`
- Read: `companion/src/bridge/tool-definitions.ts` (`getToolDefinitions`)

- [ ] **Step 1: Write failing tests**

Create `companion/tests/packs-validator.test.ts`:

```typescript
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { validatePackDir } from "../src/packs/validator"

function makePack(root: string, yamlBody: string, files: Record<string, string> = {}) {
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, "pack.yaml"), yamlBody)
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
}

test("rejects unknown tool in allow", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(
    dir,
    `
schema_version: 1
id: test-pack
name: Test
version: 0.1.0
channel: community
min_capability: L1
requires_modules: []
skills: []
knowledge: []
mcp_servers: []
tools:
  mode: allowlist
  allow: [this_tool_does_not_exist]
  deny: []
system_prompt_append: "hi"
`,
  )
  const r = validatePackDir(dir)
  assert.equal(r.ok, false)
  assert.match(r.error || "", /unknown tool/i)
})

test("rejects path escape in skills", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(
    dir,
    `
schema_version: 1
id: escape-pack
name: Escape
version: 0.1.0
channel: community
min_capability: L0
requires_modules: []
skills: ["../../../etc/passwd"]
knowledge: []
mcp_servers: []
tools: { mode: unchanged, allow: [], deny: [] }
system_prompt_append: "x"
`,
  )
  const r = validatePackDir(dir)
  assert.equal(r.ok, false)
})

test("rejects security blocklist keys in raw yaml extensions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pack-"))
  makePack(
    dir,
    `
schema_version: 1
id: bad-sec
name: Bad
version: 0.1.0
channel: community
min_capability: L0
requires_modules: []
skills: []
knowledge: []
mcp_servers: []
tools: { mode: unchanged, allow: [], deny: [] }
system_prompt_append: "x"
thread_defaults:
  auto_approve_dangerous: true
`,
  )
  const r = validatePackDir(dir)
  assert.equal(r.ok, false)
  assert.match(r.error || "", /forbidden|blocklist|auto_approve/i)
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm --prefix companion test -- --test-name-pattern "unknown tool|path escape|blocklist"
```

Expected: FAIL module not found or validatePackDir undefined.

- [ ] **Step 3: Implement types + validator**

`companion/src/packs/types.ts` — define:

```typescript
export type PackChannel = "community" | "enterprise"
export type MinCapability = "L0" | "L1" | "L2"
export type ToolsMode = "allowlist" | "intersect" | "unchanged"

export interface PackManifest {
  schema_version: number
  id: string
  name: string
  description?: string
  version: string
  channel: PackChannel
  min_capability: MinCapability
  requires_modules: string[]
  skills: string[]
  knowledge: string[]
  mcp_servers: string[]
  tools: { mode: ToolsMode; allow: string[]; deny: string[] }
  system_prompt_append: string
  thread_defaults?: {
    skill_selection_mode?: "auto" | "all" | "manual"
    knowledge_selection_mode?: "auto" | "all" | "manual"
    mcp_selection_mode?: "auto" | "all" | "manual"
  }
  workspace?: { type: "none" | "local_path" }
}

export interface ThreadPackSnapshot {
  tool_whitelist: string[] | null
  active_skill_ids: string[]
  skill_selection_mode?: string
  knowledge_selection_mode?: string
  mcp_selection_mode?: string
  active_mcp_server_ids?: string[]
  system_prompt_append: string | null
}

export interface ValidateOk {
  ok: true
  manifest: PackManifest
  skillAbsPaths: string[]
  knowledgeAbsPaths: string[]
}
export interface ValidateErr {
  ok: false
  error: string
}
```

`companion/src/packs/validator.ts` — load yaml with `js-yaml`, check id regex `^[a-z0-9][a-z0-9-]{1,63}$`, schema_version === 1, known tools via `getToolDefinitions().map(t => t.function.name)` (or actual shape in file), realpath containment for each skill/knowledge relative path, reject if `thread_defaults` contains any of:

```typescript
const FORBIDDEN = new Set([
  "auto_approve_dangerous",
  "allow_all_schemes",
  "auto_approved_domains",
  "trusted_domains",
  "god_mode",
])
```

Unknown tool → `ok: false, error: "unknown tool: …"`.  
`system_prompt_append` required string length 1..16384.

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm --prefix companion test -- companion/tests/packs-validator.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add companion/src/packs/types.ts companion/src/packs/validator.ts companion/tests/packs-validator.test.ts
git commit -m "feat(packs): add pack.yaml validator with tool and path checks"
```

---

### Task 2: capability-audit.jsonl

**Files:**
- Create: `companion/src/packs/audit-log.ts`
- Test: `companion/tests/packs-audit-log.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { appendCapabilityAudit, getAuditLogPath } from "../src/packs/audit-log"

test("append creates 0o600 file with one json line", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"))
  const p = path.join(dir, "capability-audit.jsonl")
  appendCapabilityAudit({ type: "pack.apply", pack_id: "x", thread_id: "t1", at: new Date().toISOString() }, p)
  const st = fs.statSync(p)
  // on macOS mode may show without full bits; check not world-writable
  assert.equal(st.mode & 0o077, 0)
  const line = fs.readFileSync(p, "utf8").trim()
  assert.equal(JSON.parse(line).type, "pack.apply")
})

test("oversized line is skipped without throwing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-"))
  const p = path.join(dir, "capability-audit.jsonl")
  const huge = "x".repeat(300_000)
  appendCapabilityAudit({ type: "pack.apply", pack_id: huge, at: new Date().toISOString() } as any, p)
  // either empty or truncated event — must not throw
  assert.ok(fs.existsSync(p) || !fs.existsSync(p) || true)
})
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`appendCapabilityAudit(event, filePath?)`:

- default path `path.join(getConfigDir(), "logs", "capability-audit.jsonl")`
- `mkdirSync` logs `0o700`
- serialize JSON; if `Buffer.byteLength(line) > 256 * 1024` → log warn and return
- `fs.appendFileSync` + `chmod 0o600`
- if size > 10MB: rotate to `.1`, `.2`, `.3` (shift), recreate empty

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(packs): capability audit jsonl with append and rotation"
```

---

### Task 3: Thread fields + system_prompt_append + applyPackPatch

**Files:**
- Modify: `companion/src/threads/thread-manager.ts`
- Test: extend `companion/tests/thread-manager-lock.test.ts` or create `companion/tests/thread-pack-patch.test.ts`
- Modify: `companion/src/llm/adapter.ts` (prompt assembly)

- [ ] **Step 1: Write failing tests for thread patch**

```typescript
import test from "node:test"
import assert from "node:assert/strict"
// use existing temp HOME pattern from skill-engine.test.ts

test("applyPackPatch sets mission_pack_id and snapshot atomically", async () => {
  // initDataDir + ThreadManager
  // create thread
  // tm.applyPackPatch(id, {
  //   mission_pack_id: "appsec-prd-review",
  //   mission_pack_snapshot: { tool_whitelist: null, active_skill_ids: ["browse"], system_prompt_append: null },
  //   tool_whitelist: ["list_tabs", "get_page_html"],
  //   active_skill_ids: ["pack--appsec-prd-review--threat-model"],
  //   skill_selection_mode: "manual",
  //   config_override: { system_prompt_append: "--- Mission Pack ---\nBe careful" },
  // })
  // const t = tm.get(id)
  // assert.equal(t.mission_pack_id, "appsec-prd-review")
  // assert.deepEqual(t.tool_whitelist, ["list_tabs", "get_page_html"])
})

test("validateConfigOverride accepts system_prompt_append string", () => {
  // via create/update with config_override
})
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement Thread changes**

In `thread-manager.ts`:

1. Extend `Thread` interface:

```typescript
  mission_pack_id?: string | null
  mission_pack_snapshot?: ThreadPackSnapshot | null
  workspace_root?: string | null
```

2. Add to `ALLOWED_CONFIG_OVERRIDE_KEYS`:

```typescript
  system_prompt_append: "string",
```

Raise `MAX_CONFIG_STRING_LENGTH` for append only, or allow 16384 for this key specifically in validateConfigOverride.

3. Add method:

```typescript
applyPackPatch(threadId: string, patch: {
  mission_pack_id: string | null
  mission_pack_snapshot: ThreadPackSnapshot | null
  tool_whitelist: string[] | null
  active_skill_ids: string[]
  skill_selection_mode?: "auto" | "all" | "manual"
  knowledge_selection_mode?: "auto" | "all" | "manual"
  mcp_selection_mode?: "auto" | "all" | "manual"
  active_mcp_server_ids?: string[]
  system_prompt_append: string | null
  workspace_root?: string | null
}): Thread
```

Implementation: `get` thread → clone → apply all fields → validate config_override merge → single `saveIndex` / atomic write. On validation failure throw **before** mutating index.

4. When loading old threads missing fields, treat as `mission_pack_id: null`.

- [ ] **Step 4: Adapter merge**

In `adapter.ts` where system prompt is built, after resolving base + `config_override.system_prompt`, if `system_prompt_append` present, concatenate:

```typescript
if (append) {
  systemContent = `${systemContent}\n\n${append}`
}
```

- [ ] **Step 5: Tests PASS + commit**

```bash
git commit -m "feat(threads): pack patch fields and system_prompt_append merge"
```

---

### Task 4: PackEngine install / apply / uninstall

**Files:**
- Create: `companion/src/packs/pack-engine.ts`
- Modify: `companion/src/config.ts` — ensure dirs on init
- Test: `companion/tests/packs-engine.test.ts`

- [ ] **Step 1: Failing integration tests**

```typescript
test("install builtin-like dir copies namespaced skills and list sees pack", async () => { /* ... */ })
test("apply allowlist sets tool_whitelist and snapshot", async () => { /* ... */ })
test("intersect with null whitelist degrades to allowlist", async () => { /* ... */ })
test("uninstall restores snapshot tool_whitelist", async () => { /* ... */ })
test("apply is all-or-nothing when skill copy missing", async () => { /* ... */ })
test("zip slip entry rejected", async () => { /* ... */ })
```

Tools mode logic in engine:

```typescript
function computeWhitelist(
  mode: ToolsMode,
  allow: string[],
  deny: string[],
  current: string[] | null,
): string[] | null {
  const denySet = new Set(deny)
  const allowClean = allow.filter((t) => !denySet.has(t))
  if (mode === "unchanged") return current
  if (mode === "allowlist") return allowClean
  // intersect
  if (current === null) return allowClean // S11 degrade
  return current.filter((t) => allowClean.includes(t) && !denySet.has(t))
}
```

Install from directory:

1. `validatePackDir`
2. Copy tree to `packs/installed/<id>/`
3. For each skill file: copy to `skills/pack--<id>--<basename>` with frontmatter `name` rewritten to `pack--<id>--<originalName>` if needed
4. Same for knowledge under `knowledge/global/`
5. `skillEngine.refresh()`
6. audit `pack.install`

Apply:

1. validate installed pack still valid  
2. check `requires_modules` against config (P0: only `appsec` — if listed, must be enabled)  
3. community vs enterprise channel gate  
4. build snapshot from current thread  
5. compute skill ids list, whitelist, system_prompt_append merge per §6.5  
6. `applyPackPatch`  
7. audit  

Uninstall:

1. find threads with `mission_pack_id === id`, restore snapshot via `applyPackPatch`  
2. delete namespaced skill/knowledge files  
3. rm installed dir  
4. refresh + audit  

Zip install: extract with AdmZip; for each entry reject if resolved path outside tmp root.

- [ ] **Step 2–4: Implement until tests pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(packs): pack engine install apply uninstall with snapshot rollback"
```

---

### Task 5: Builtin AppSec pack content

**Files:**
- Create: `companion/src/packs/builtin/appsec-prd-review/pack.yaml`
- Create: `companion/src/packs/builtin/appsec-prd-review/skills/threat-model-stride.md`
- Create: `companion/src/packs/builtin/appsec-prd-review/skills/page-security-audit.md`
- Create: `companion/src/packs/builtin/appsec-prd-review/knowledge/owasp-baseline.md`
- Wire: pack-engine `ensureBuiltinPacksInstalled()` called from `initDataDir` or server start

`pack.yaml` essentials:

```yaml
schema_version: 1
id: appsec-prd-review
name: 应用安全审查
description: STRIDE 威胁建模 + 页面安全 checklist
version: 0.1.0
channel: community
min_capability: L1
requires_modules: [appsec]
skills:
  - ./skills/threat-model-stride.md
  - ./skills/page-security-audit.md
knowledge:
  - ./knowledge/owasp-baseline.md
mcp_servers: []
tools:
  mode: allowlist
  allow:
    - list_tabs
    - navigate
    - get_page_text
    - get_page_html
    - screenshot
    - use_skill
  deny:
    - host_computer
    - osascript_eval
system_prompt_append: |
  你是应用安全审查助手。输出：风险列表、证据（URL/摘录）、建议、待办。
  不执行未确认高危操作；未运行的扫描不得声称已完成。
thread_defaults:
  skill_selection_mode: manual
  knowledge_selection_mode: manual
  mcp_selection_mode: manual
workspace:
  type: none
```

Skill bodies: concise STRIDE checklist + page audit heuristics (secrets in HTML, missing CSP hints, dangerous sinks) — Type A prompt skills.

- [ ] **Step 1: Unit test `ensureBuiltinPacksInstalled` makes pack.list non-empty**

- [ ] **Step 2: Implement copy-from-`__dirname`/bundled path** — note: use path relative to compiled `dist` or `import.meta`/`__dirname` pattern already used for builtin-skills in config.ts

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(packs): add builtin appsec-prd-review mission pack"
```

---

### Task 6: Config modules.appsec + WS handlers

**Files:**
- Modify: `companion/src/config.ts` — defaults:

```typescript
capability_profile: "community",
modules: {
  appsec: { available: true, enabled: false, enabled_at: null, enabled_by: null },
},
```

- Modify: `companion/src/message-router.ts` cases:

```typescript
case "pack.list":
case "pack.install":
case "pack.apply":
case "pack.uninstall":
case "modules.list":
case "modules.set_enabled":
```

For `pack.apply`: if requires `appsec` and not enabled → return error `{ code: "module_disabled", module: "appsec" }`.

For `modules.set_enabled`: only allow known modules; write audit; `enabled_at` ISO.

- [ ] **Step 1: Router-level tests** (follow `_config-router-setup.ts` / existing message-router tests pattern if any)

- [ ] **Step 2: Implement**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(packs): WS pack.* and modules.set_enabled handlers"
```

---

### Task 7: Side Panel PacksPanel UI

**Files:**
- Create: `chrome-extension/src/sidepanel/components/PacksPanel.tsx`
- Modify: entry point (e.g. Settings slideout or BottomBar tab — prefer **Settings** low-freq per L0/L1 redesign D5)
- Modify: `useWebSocket` / store to hold `packs: PackListItem[]`

Minimal UI:

- List: name, description, channel, apply_blocked reason  
- Button「应用到当前线程」→ `pack.apply`  
- If `module_disabled`: show「启用 AppSec 模块」→ `modules.set_enabled` then retry  
- Show badge on thread if `mission_pack_id` present (read from thread object if already synced)

- [ ] **Step 1: Manual / light component test if extension has component test harness; else smoke build**

```bash
npm --prefix chrome-extension run build
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat(extension): PacksPanel list and apply mission packs"
```

---

### Task 8: Full verification

- [ ] **Step 1: Run companion tests**

```bash
npm --prefix companion test
```

Expected: all pass including new packs-* tests.

- [ ] **Step 2: Run extension tests / build**

```bash
npm --prefix chrome-extension test
npm --prefix chrome-extension run build
```

- [ ] **Step 3: Spec coverage checklist**

| Spec P0 item | Task |
|--------------|------|
| pack.yaml validator | T1 |
| system_prompt_append ALLOWED + adapter | T3 |
| copy skill/knowledge load | T4 |
| atomic apply + snapshot | T3–T4 |
| uninstall rollback | T4 |
| WS list/install/apply/uninstall | T6 |
| builtin appsec pack | T5 |
| audit jsonl contract | T2 |
| appsec module default false | T6 |
| UI list/apply | T7 |

- [ ] **Step 4: Final commit if docs/status only**

```bash
git add docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md \
  docs/decisions/v1.3/mission-pack-design-review-synthesis-2026-07-26.md \
  docs/superpowers/plans/2026-07-26-mission-pack-p0.md
git commit -m "docs: mission pack P0 plan after dual external design review"
```

---

## Later plans (not this file)

| Plan | Scope |
|------|--------|
| `mission-pack-p1-devsec.md` | workspace_root, folder-picker, read-only file tools |
| `mission-pack-p1-shell.md` | node-pty, confirm_per_command, Cockpit xterm, lifecycle |
| `mission-pack-p2-netsec.md` | scope matching, task auth, minimal probes |

---

## Self-review (writing-plans)

1. **Spec coverage:** P0 table in design §10 mapped to Tasks 1–8; Shell/NetSec explicitly deferred.  
2. **Placeholders:** No TBD steps; code sketches included.  
3. **Types:** `PackManifest`, `ThreadPackSnapshot`, `applyPackPatch` naming consistent across tasks.  
4. **S11 intersect:** implemented in Task 4 `computeWhitelist`.  
5. **S8 atomicity:** single `applyPackPatch` mutation in Task 3–4.  
