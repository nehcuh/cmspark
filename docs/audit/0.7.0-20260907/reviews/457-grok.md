I'll review only `457-acceptance.md` as specified—no commands, edits, subagents, or other reports. Reading that file and the review protocol first.The packet continues past the architecture excerpt; I'll read the rest before judging isolation and claims.# #457 bounded acceptance tooling — independent source review

Packet-only `[inspected]`. No execution, no other files. Scope is this rehearsal + its docs. **Not** core, MCP, installer, release, or real/pilot acceptance.

## BLOCK

None. The ledger does **not** treat installer / real model / enterprise pilot as passed. Status is 未达到发布条件; `not_verified` and the blocker table match that.

## MAJOR

**M1. Runtime isolation is not a sandbox; current vs old is compile-input isolation only.**

- Phase children are spawned with `run(...)` default `cwd: root` (live worktree). `{ env }` does not override cwd. Producers that write `process.cwd()`-relative files can mutate the repo.
- `env` replaces `process.env` (good for API keys) but does **not** block `os.homedir()` (passwd db, not `HOME`). Packet cannot prove `initDataDir` / grants / evidence never touch the operator home or cwd-relative config.
- Old and current trees **symlink live** `companion/node_modules`. Old `tsc` + old `require` are 0.6.6 **source** + **current** deps. That is not a 0.6.6 install replay.
- `not_verified` lists installer/app/OS/model, not cwd/home/shared-deps. Ledger paragraph (“3 独立子进程，合成数据”) oversells isolation.

Freeze of `companion/src` + `tsconfig.json` + `package.json` **does** stop compile races on those inputs. That is not sealed current/old runtime isolation.

**M2. `verified[]` is a hardcoded manifesto, and one item is not actually asserted.**

PASS is printed as a literal JSON blob after three `execFileSync`s. Labels are not derived from asserts.

`"old grant writer preserves new permission fields"`:

- Old hop: `issueOutboundGrant({ caller_id: 'old-writer', ... })` — **return unused**, no grants-file snapshot, no assert on the new record.
- New fields are checked only later via `lookupContextGrant` on the **create-time** context grant.
- If old `issue` only appends and never rewrites, the property is vacuous. If `lookupContextGrant` defaults missing flags, the assert still passes after a strip.

What **is** asserted: ordinary token still verifies; old **parser** rejects the new context profile (`ok === false`); after the old process, new lookup still sees `allow_context_export` / knowledge ids / origins. That is “new context grant survived old process,” not “old writer preserves new fields.”

**M3. Old hop does not exercise evidence/draft producers; “往返” is asymmetric.**

| Hop | Evidence/draft | Grants | Knowledge/future bytes |
| --- | --- | --- | --- |
| create (current) | real `BusinessEvidenceService` + `capture` | real `issueOutboundGrant` | write |
| old (0.6.6 dist) | **raw `readFileSync` only** — no store/service | `initDataDir` + `verify` + `issue` | raw bytes |
| verify (current) | create/update deepEqual, revision 2, citation id, `ready===false`, future `EVIDENCE_SCHEMA_UNSUPPORTED` | verify + lookup | bytes |

Ledger: “当前源码 → 固定 63b449d… → 当前源码” and “源码数据层兼容.” Old evidence **reader/migrator** is not shown to run. Unknown-schema preservation across old is “old process didn’t clobber files,” not “old EvidenceStore refused and preserved.” Honest only if rewritten to that.

## NIT

- `candidate_source_sha256` omits the rehearsal script, embedded `phase.cjs`, and `page-read-v1.json` (live-tree read). Result JSON is not bound to procedure or fixture.
- `readdirSync(evidenceDir)[0]` is unordered; OK only if exactly one file exists.
- Citation `start` uses `indexOf('REL-1')` with no assert the fixture contains it; `end: start + 5` assumes BMP.
- Synthetic `target.environment: 'prod'` plus example host — ledger forbids dressing examples as pass; keep that discipline.
- Architecture speaks as “0.7.0 的职责”; ledger correctly keeps **version 0.6.6**. Fine if not read as shipped.
- File modes `0o600` are written, never `stat`’d after the old hop. “Permissions” in the ledger means grant **fields**, not inode mode.
- Packet embeds Companion 4973 / Extension 1277 / MCP 11/11 / package 124. **Out of scope here; unauthenticated in this file.**

## What the executable *does* get right

- Temp workspace, `finally` `rmSync`; tokens not in stdout.
- Baseline `git archive` of `companion` at `63b449d9…` + `package.json` `0.6.6`.
- Current src copied then compiled from the copy (`--outDir currentDist`).
- Three separate node processes; `CMSPARK_DATA_DIR` asserted; path prefix `cmspark-roundtrip-`.
- Future file = producer JSON with **only** `schema_version = 999`.
- Verify: idempotent create/update, revision 2, citation observation id, synthetic `ready === false`, unknown schema throw + bytes unchanged.
- `not_verified` includes real enterprise, installer, mixed browser/Companion, other OS, production model.
- Blocker table still requires real OS/browser/model, both missions, negatives, MCP client, install/mixed-version. “本次机器检查不授权绕过.”

## Docs vs over-claim

`release-acceptance.md` does **not** claim installer/real-model/enterprise pass. Architecture points at remaining pagination/iframe/relation gaps and true-pilot as release gates. Do not promote M2/M3 labels into those gates.

## VERDICT

**NEEDS_FIX (MAJOR blocks). Not approved.**

Do **not** treat this as PASS for core, MCP, package/release, real environment, production model, or enterprise pilot. Those rows are hearsay in this packet.

To clear MAJORs, at least:

1. Spawn phases with `cwd: workspace` (or chroot-equivalent); document `os.homedir()` / shared `node_modules` in `not_verified`.
2. Replace the grant-writer slogan with asserts that match the code (grants-file bytes before/after old `issue`, or explicit rewrite), or drop the slogan.
3. Either load 0.6.6 evidence store on the old hop or document that the old hop is grant-only + raw byte conservation.

Until then, `roundtrip-result.json` `PASS` is a synthetic current-src → old-src grants/bytes smoke, not isolated 0.6.6 runtime and not release evidence.
