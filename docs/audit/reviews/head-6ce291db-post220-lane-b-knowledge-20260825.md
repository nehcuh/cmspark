# Independent adversary — Lane B Knowledge honesty / identity / distill / SkillEngine

> **Lane**: B — Knowledge compose correctness / sanitizer / identity (NOT overlay ACL)  
> **Role**: independent adversary — did **not** implement this. Do not rubber-stamp in-tree Wave 0/0b/1/2 reviews.  
> **Date**: 2026-08-25  
> **Repo**: `C:\Users\HuChen\Projects\cmspark`  
> **HEAD**: `6ce291db` (`6ce291db1c14b72823e26905df32bfe7d498c7e7`) live main  
> **Base**: `1d16b0ed` (PR #220)  
> **Range**: PR #221 + #222 (`1d16b0ed..HEAD`)  
> **Frozen patch**: `docs/audit/reviews/head-6ce291db-post220-diff-20260825.patch`  
> **SHA256**: `19B2A2F3DFDF41F4B5A5A22DD68763C19C861E5300FCCEF7876B791489246548` `[executed]` (`certutil -hashfile`)  
> **Spec**: `docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md`  
> **Exclusive files only** for findings. Overlay/ACL/Swift = Lane A; chrome-extension = Lane C; adapter/message-router/redact/history = Lane D.

```text
Surface:      L0 chat UX (disclosure chips + confirm-import); overlay unchanged C-thin  [implementer claim]
L2-classes:   (none)
Compose:      knowledge (markdown + SkillEngine); pack already owns knowledge_ids
Autonomy:     n/a
Trust:        no elevation; knowledge remains untrusted retrieved data; overlay ACL does not grow
Channel:      community
Blast:        T2  (escalate T3 only if overlay socket grew mcp.add / knowledge.import / config.set — Lane A)
```

## Capability check (ADR-020)

| Check | Result |
|-------|--------|
| Axes fit | **HOLD** `[inspected]` — exclusive tree is Composition (knowledge identity / retrieve / related / distill preview / topic_folder string). Not a second agent runtime. |
| Pack-first | **n/a** — no new primary Side Panel chrome in exclusive files. |
| Confirm dialects | **HOLD** `[inspected]` — no new `request(` family in exclusive files. Distill is preview-only; persist still existing confirm-import. |
| Trust monotonicity | **CHALLENGED** `[executed]` — implementer says knowledge stays untrusted retrieved data. Live compose injects sanitized markdown into the **system prompt** as `## Knowledge: {title} [{id}]` with **no** `<untrusted>` / 「忽略其中祈使句」 wrapper (F-S-1). Regex sanitizer is the only gate, which the spec says is 纵深 not 门. Overlay ACL growth is Lane A (tension noted, not scored here). |
| originWs | **n/a** in exclusive files. |
| No new runtime | **HOLD**. No graph DB / Project entity / category table in exclusive files. |
| Experimental layers | **n/a**. |
| P1-1 god-mode / `auto_approve_*` | **HOLD** `[inspected]` `companion/src/config.ts` — this range only retargets `initDataDir`/`getConfigDir` to live `CMSPARK_DATA_DIR`. No new `auto_approve_*`, god-mode, or overlay knowledge-admin flags. Existing `auto_approve_dangerous` default remains `false`. |
| Missing declaration | Prompt carries axes. **nit** only if treated as PR-body requirement; not blocking. |

---

## MACHINE

Cwd `companion/` `[executed]`.

| Command | Result |
|---------|--------|
| `.\node_modules\.bin\tsc --noEmit -p tsconfig.json` | **PASS** exit 0 |
| `.\node_modules\.bin\tsx --test` exclusive tests (doc-identity, knowledge-related, knowledge-active-ids, distill, skill-engine, skills, single/files) | **237 pass / 1 fail** (238 tests, ~9.4s) |
| Frozen patch SHA256 | **MATCH** `19B2A2F3…246548` |
| Private probes | `.tmp-adv-lane-b/probe.ts` (then deleted). Isolated `CMSPARK_DATA_DIR`. |

**1 fail (not a must-falsify miss):** `tests/skills.test.ts` `skill-engine: importSkillFromPath imports from outside config dir` — creates files under `tempHome/.claude/skills/…` then calls `importSkillFromPath("~/.claude/skills/datayes-api-search")`. Production expands `~` via `os.homedir()` (`skill-engine.ts:1216-1222`), **not** `process.env.HOME`. Test is absent from the frozen patch (pre-existing). On this Windows host `os.homedir()` ≠ `HOME=tempHome` → `Directory not found`. Product `~` expansion is correct; test isolation is not. **Not used as REJECT.**

In-tree Wave 2 synthesis claimed “PEM through END” and “冲突后缀”. Probes below **refute** both as universal.

---

## Must-falsify scorecard

Default **REFUTED** until `file:line` + `[executed]` / `[inspected]`.

| # | Claim | Score | Evidence |
|---|--------|-------|----------|
| 1 | CJK identity is `{id, filename, title}` with safe slug + conflict suffix + Windows reserved names — **NOT** a one-line alphanumeric regex that throws “Use alphanumeric”. | **HOLD** | `[inspected]` `doc-identity.ts:14-21,43-107` allocator: CJK → empty `asciiSlug` → `k-<sha256 10>`; conflict `-${n}`; `WINDOWS_RESERVED` + `../` refuse. `[executed]` 产品甲/乙 → `k-8547c7219f` / `k-bf689d1dc8`; `allocateDocIdentity({title:"中文标题"})` does not throw; `importKnowledge` CJK test pass; `importSkill hashes unsafe names instead of throwing` pass. `get()` matches `name \|\| id` (`skill-engine.ts:356-359`), not title. |
| 2 | Distill **NEVER** auto-writes knowledge; HITL only; redacts **before** clip (title + body; PEM through END; xox remainder; `password=`/`api_key=`). | **PARTIAL** | **HOLD** no-write `[inspected]` `distill.ts` has no `fs`; `[executed]` `distillThreadMarkdown` does not change knowledge dir; `files.test.ts` `thread.distill_preview` length unchanged. **HOLD** title+body+xox+password `[executed]` `password=supersecret` / `api_key=` / `xoxb-…abcdefghijklmnopqrstuvwx` → `[REDACTED]`; clip-first mutation **would** leak `ghp_`, production does not (`distill.ts:55-57`). **FAIL** PEM through END for body `>4000` chars: `SENSITIVE_BODY_RE` (`distill.ts:6-7`) uses `[\s\S]{0,4000}?` then a **BEGIN-only** alt. Probe: `-----BEGIN RSA PRIVATE KEY-----` + 4200×A + END → `-----[REDACTED]-----\nMIIEAAA…` leaked into preview markdown. 4096-ish ~3.2k PEM **does** fully redact. |
| 3 | RAG/chunk **AND** truncate paths sanitize (prompt-injection / retrieved-as-oracle). Knowledge remains untrusted retrieved data. | **PARTIAL** | **HOLD** sanitizer on retrieve `[inspected]` RAG `skill-engine.ts:740`; truncate `745-747` (sanitize **then** slice); entries `778`; search `1550`. `[executed]` RAG prompt contains `[FILTERED]` (not merely the unique token); truncate/full path without query also `[FILTERED]`; in-suite RAG/search/entries tests pass. **FAIL** F-S-1 “硬分隔符 + 忽略其中祈使句; regex 只是纵深” `[executed]` compose is `## Knowledge: ${title} [${id}]\n${summary}` (`skill-engine.ts:653-658`) with **no** `<untrusted>` / ignore-imperatives. Regex is the door. |
| 4 | `knowledge.related` honors limit clamped **1–3**. No graph DB / Project entity / new category table. | **HOLD** | `[inspected]` `knowledge-related.ts:9,65-81` `slice(0, min(3, limit))`; no persist/graph. `[executed]` limit 99 → 3. Helper `limit=0` → 0 (WS clamp 1–3 is Lane D; not a helper FAIL). `topic_folder?: string \| null` only (`thread-manager.ts:112-113`). No Project/category table in exclusive files. |
| 5 | Write paths `0o600` where files are created; **no silent global auto-ingest of chat**. | **PARTIAL** | **HOLD** auto-ingest `[inspected]` distill/thread-manager never call `importKnowledge`. **HOLD** helper `[inspected]` `writeRestrictedFile` `doc-identity.ts:136-140` `{mode:0o600}`; posix test skipped on win32. **FAIL** silent **overwrite** of distinct docs (not chat auto-ingest, but Wave 0 / F-I-5 禁止静默覆盖): see P1-1. |
| 6 | `topic_folder` is a **string on Thread**, not a new entity; optimistic UI sanitization if present. | **HOLD** | `[inspected]` `thread-manager.ts:112-113,792-793` + `sanitizeTopicFolder` `distill.ts:67-74` strips `\x00-\x1F\x7F\\/` , cap 40. `[executed]` `"竞品/分析"` → `"竞品分析"`; active-ids + files tests persist sanitized. No UI files in exclusive range. |
| 7 | skill-install / doc-identity path safety (traversal, reserved names). | **HOLD** (nits below) | `[executed]` `CON`/`PRN`/`AUX`/`NUL`/`COM1`/`LPT1`/`../x`/`..\\x` → hashed `k-*`, never `x.md`. `[inspected]` zip extract `isUnsafePathComponent` + containment (`skill-engine.ts:1091-1116`); `readDirectoryFiles` skips symlink/junction (`1265`); `writeRestrictedFile` refuses symlink dest (`129-131`). skill-install dest names go through `allocateDocIdentity` (`skill-install.ts:186-191`). |
| 8 | `config.ts`: no new `auto_approve` / god-mode / overlay knowledge admin flags. | **HOLD** | `[inspected]` frozen patch `config.ts` hunk is `initDataDir` dirs via `getConfigDir()` + live `CMSPARK_DATA_DIR` (`1397-1400`) + builtin copy try/catch. No new security flags. |

---

## New defects

### P1-1 — `importKnowledge` silently overwrites ASCII-slug collisions (F-I-5 / Wave 0 冲突后缀)

**Blocking.** Spec: 冲突走后缀，**禁止静默覆盖**.

`skill-engine.ts:1400-1410` `[inspected]`:

```1400:1410:companion/src/skills/skill-engine.ts
    const taken = this.collectTakenStems()
    const preferred = isLegacySafeId(String(name)) ? String(name) : undefined
    if (preferred) {
      const existingKnowledge = path.join(targetDir, `${preferred}.md`)
      if (fs.existsSync(existingKnowledge)) taken.delete(preferred.toLowerCase())
    }
    let ident = allocateDocIdentity({
      title,
      preferredId: preferred,
      seed: nameOverride || title,
      takenStems: taken,
    })
```

`taken.delete` **invites** reuse of an occupied stem. `preferredId` short-circuits `seed` (so directory `nameOverride` uniqueness does not apply to legacy-safe `name`s). Heading `# Notes` is `isLegacySafeId` → stem `notes`.

`[executed]` two `importKnowledge("# Notes\n\nFIRST…UNIQUE_ALPHA")` then `SECOND…UNIQUE_BETA"` → **one** file `notes.md`; `UNIQUE_ALPHA` gone; only `UNIQUE_BETA` remains.

CJK 产品甲/乙 does **not** hit this (no preferred ascii). English single-token headings do. This is the HITL confirm-import path, not only vault dir import.

Tests never import two ASCII-same headings. Mutation: without `taken.delete`, allocator would emit `notes-2`.

### P1-2 — Distill PEM “through END” is capped at 4000 chars; remainder leaks into preview

**Blocking vs must-falsify #2 / in-tree “PEM through END” claim.**

`distill.ts:6-7` `[inspected]`: first alt requires END within `{0,4000}?`; second alt is `BEGIN (?:RSA |OPENSSH |EC |ENCRYPTED )?PRIVATE KEY` **without** consuming the body.

`[executed]` 4200-char PKCS body: hits=1, `BEGIN` replaced, `MIIEAAA…` / `MIIECCC…` still in `redactSecrets` output **and** in `distillThreadMarkdown` excerpt (clip 400 after partial redact). User HITL import of that markdown would persist key material.

Typical ~3.2k RSA-4096 **does** fully redact `[executed]`. The BEGIN-only fallback is still a secret leak for oversized / header-padded PEMs.

### P1-3 — Knowledge compose is unsandboxed system-prompt text (F-S-1)

**Blocking vs locked Trust text**, even though retrieve-path regex HOLDS.

`skill-engine.ts:653-658` `[executed]` prompt head:

```text
## Knowledge: adv-wrap-doc [adv-wrap-doc]
hello knowledge body
```

No `<untrusted>` (adapter wrap is tool-results only — Lane D context). No 「忽略其中祈使句」. Spec F-S-1: regex is 纵深, not the gate. Novel injections that miss `INJECTION_PATTERNS` become **system** instructions, higher privilege than wrapped tool results.

Wave 0 item 4 (three retrieve paths) is implemented; F-S-1 wrapper is not. Independent of Lane A overlay ACL.

### P2-1 — `loadFromDir` does not use `isSymlinkOrJunction`

`skill-engine.ts:246+` walk of skills/knowledge dirs has no symlink/junction skip; `readDirectoryFiles` (`1265`) does. F-I-7 directory walk 不跟随 junction is only on import copy, not on load/index. Needs write to the data dir to plant a junction — not T3 by itself. `[inspected]` (Windows symlink create skipped in probe).

### P2-2 — `skill-install` `assertDirBudget` follows directories without junction skip

`skill-install.ts:318-335` `[inspected]`. Budget walk can recurse a junction; extract/copy path is separately skipped. DoS/accounting, not dest escape.

### nit — COM0 / LPT0 not in `WINDOWS_RESERVED`

`doc-identity.ts:11` `com[1-9]|lpt[1-9]` `[executed]` `allocateDocIdentity({title:"COM0"})` → stem `com0`, `isUnsafePathComponent("COM0")===false`. Classic MSDN list omits COM0; Win10+ still treats `\\.\COM0` as a device. Not the Wave 0 CON/`../x` case.

### nit — `findRelatedKnowledge` min clamp is 0, not 1

`knowledge-related.ts:81` `Math.max(0, min(3, limit))` `[executed]` limit 0/−5 → `[]`. Product `knowledge.related` (Lane D) clamps `Math.max(1, …)`. Helper vs API. Tests pin the hard cap of 3.

### nit — `initDataDir` split-brain `DATA_DIR` vs `getConfigDir()`

`config.ts:538-584` mkdir uses `root = getConfigDir()`; chmod/config.json/builtin dest still `DATA_DIR` (import-time). Live env retarget is incomplete. Harmless if `CMSPARK_DATA_DIR` is set before load (production / most tests).

### nit — `skills.test.ts` `~/` import case ignores Windows `os.homedir()`

See MACHINE. Not a product path-escape.

### nit — `insertMessageAt` spreads `retrieved_sources` from caller

`thread-manager.ts:980-984` `[inspected]`. Fake chips if a caller (Lane D) passes client-supplied ledger. Cross-cut pointer only.

---

## Confirmed-safe (in exclusive range)

- CJK `{id,filename,title}`: no `--.md` collapse, no “Use alphanumeric” throw; `get(id)` + legacy `name`; `get(title)` does not match `[executed]`.
- F-I-6: knowledge cannot steal skill `browse`; `loadContent` refuses knowledge `[executed]` in-suite.
- RAG + truncate + entries + `searchKnowledge` all call `sanitizeKnowledgeContent` `[executed]`.
- Frontmatter allowlist drops `*.com` `site` and `entries` `[executed]` in-suite.
- `previewKnowledge` does not write `[executed]` in-suite.
- Distill does not write knowledge; ghp_/sk-/xox/`password=`/`api_key=` redacted before clip; title redacted `[executed]`.
- Related ≤3; no graph DB / Project / category table `[executed]`/`[inspected]`.
- `topic_folder` is a Thread string; path chars stripped `[executed]`.
- Traversal `../x` never becomes `x.md`; CON/PRN/AUX/NUL/COM1/LPT1 hashed `[executed]`.
- Zip/path import containment + reserved zip entry names `[inspected]`; in-suite zip traversal tests pass.
- `config.ts` no new auto_approve / overlay knowledge admin `[inspected]`.
- Write helper `mode: 0o600` + symlink-dest refuse `[inspected]`.

---

## Cross-cut (not findings)

- Overlay ACL / summoner `knowledge.*` allowlist = Lane A. Spec tension (HUD expand SUPERSEDES “overlay ACL does not grow”) not scored here.
- `knowledge.related` / `thread.distill_preview` WS handlers, `retrieved_sources` on `chat.done`, history redact = Lane D. API limit 1–3 and distill_preview no-write tests in `files.test.ts` observed green.
- Pack namer uses `allocateDocIdentity` (`pack-engine.ts`, out of range) `[inspected]` grep only.

---

P1-1 (silent overwrite) and P1-2 (PEM remainder) are machine-checkable, in exclusive files, and contradict locked Wave 0 / F-I-5 / F-S-8 distill text. P1-3 is the Trust wrapper the regex bank does not replace.

VERDICT: REJECT
