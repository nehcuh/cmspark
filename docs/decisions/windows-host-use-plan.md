# Windows Host-Use Implementation Plan

> **Branch**: `computer-use-w8-windows` (from `computer-use-w8-snapshot`, HEAD `44d27e9`)
> **Author**: Planning agent (read-only) · **Date**: 2026-07-17 (local, UTC+8)
> **Status**: Adversary-reviewed, verdict `PLAN CORRECT WITH MANDATORY AMENDMENTS` (see `windows-host-use-adversary.md`). **The "Amendments (adversary-mandated)" section at the bottom OVERRIDES conflicting main text — dev must implement the amended version.** → dev
> **Supersedes for COM-based paths only**: the "Windows = Phase 1.5 gated on EV cert" conclusion in `computer-use-round2-synthesis.md` §6.2. The UIAccess findings remain valid for UI-driving paths (see §G NON-goals).

## 0. Empirical evidence collected on this machine (2026-07-17)

| Probe | Result | Implication |
|---|---|---|
| `powershell.exe` 5.1.28000.2525 present, OS build 10.0.28000 (Win11) | ✅ | Windows PowerShell 5.1 guaranteed on Win10/11; no pwsh dependency |
| `New-Object -ComObject Outlook.Application` | ❌ `0x80040154 REGDB_E_CLASSNOTREG` | This machine has **New Outlook** (MSIX) — no COM. Typed-error surface for absent classic Outlook is the common case |
| `New-Object -ComObject OneNote.Application` | ❌ `0x80040154` | Same detection/fallback requirement for OneNote |
| WinRT `UserConsentVerifier` from **unsigned** PS 5.1: type loads; `CheckAvailabilityAsync()` → `DeviceNotPresent` | ✅ API works unsigned | Windows Hello needs **no EV cert, no UIAccess** (OS-hosted dialog). `DeviceNotPresent` here = VM; fallback path required |
| Sticky Notes `plum.sqlite` | not present | Sticky Notes is a poor default note target |
| Test pipeline `tsc -p tsconfig.test.json && node --test` in Git Bash | ✅ 27/27 pass | node v24.15.0 |

Also verified: the **extension already implements the manual-nonce UI** (`chrome-extension/src/sidepanel/App.tsx:135-199,299-377`). The companion-side W9 TODO at `server.ts:1310` is unwired. **Zero chrome-extension changes required.**

## A. Scope for this branch

### Key architectural insight
Phase 0 spike proved unsigned binaries can't do **UIAutomation / SetForegroundWindow / SendInput** (UI-driving). But the Phase 1 `HostAdapter` contract is a **data contract** — satisfiable through **COM automation and the filesystem**, which never touch UI tree / UIPI / UIAccess:

- **Classic Outlook COM** is out-of-process IPC into the object model (MAPI). Object Model Guard prompts only when AV inactive/out-of-date by default. Unguarded fields: `SenderName`, `Subject`, `ReceivedTime`, `Body`.
- **OneNote desktop COM** exposes a data API (page hierarchy + XML content).
- **Node `fs`** unsigned-safe.
- **Windows Hello** `UserConsentVerifier` — genuine biometric tier, callable unsigned (verified).

### Per-TargetKind verdict

| Kind | Verdict | Mechanism | Parity note |
|---|---|---|---|
| `mail-inbox` | ✅ **Implement (read-only)** | PS → classic Outlook COM. List top-N inbox; read one by EntryID. | Matches darwin scope (no mail writes anywhere). New Outlook → typed `WinAppNotAvailable` with browser fallback message. |
| `file` | ✅ **Implement (list + metadata read + move)** | Node `fs`. Metadata-only readOne; move via `fs.rename`, **restricted to allowlisted roots under `%USERPROFILE%`** (hardening W-1). | Matches darwin metadata-only + Finder move. Root allowlist is deliberate hardening beyond darwin. |
| `note` | ✅ **Implement (create only)** | PS → OneNote COM: `GetSpecialLocation(hslUnfiledNotesSection)` → `CreateNewPage` → `UpdatePageContent` (XML). | Matches darwin Notes-create-only. Absent → typed `WinAppNotAvailable`. |
| `update`, `delete` payloads | ❌ **Throw honest errors** | — | Exact darwin parity (still throws on macOS today). |
| UI-driving | ❌ **NON-goal** | — | Requires UIAccess + EV cert. RUNBOOK evidence stands. |

### Deferred-item error surface
- `NotImplementedOnPlatform` — keep class, fix stale message `"Phase 0 macOS-only"` → `host_use: not implemented on <platform>`.
- **New** `WinAppNotAvailable extends Error` — `(appToken, hint)`; on COM `0x80040154` / missing script. Names missing app + browser fallback.
- **New** `WinPathOutsideAllowlist extends Error` — fs paths escaping `%USERPROFILE%` roots.
- Windows Hello unavailable → **not an error**: automatic downgrade to manual-nonce (method recorded in audit log).

## B. TargetId format for win

Honors locked contract (`host-adapter.ts:79-84` + `targetid-format-synthesis.md` Q2 Option A).

**Grammar:** `win:<app>:<account-or-root>:<kind>-<stable-id>`; app ∈ {outlook, onenote, fs}; kind ∈ {msg, note, file}.

| Kind | Concrete form | Stable id semantics |
|---|---|---|
| mail | `win:outlook:<store-slug>:msg-<MAPI-EntryID-hex>` | EntryID store-assigned, survives restarts; changes on cross-store move → read-time fail (accepted, darwin parity). Store slug = sanitized SMTP/store name. |
| note | `win:onenote:<section-slug>:note-<sanitized-page-id>` | OneNote page IDs stripped of `{ } -`. |
| file | `win:fs:<root>:file-<base64url(relative-path)>` | root ∈ {documents, desktop, downloads}. Self-describing, restart-proof. |

**Validator** (`WinHostAdapter.validateTargetId`), mirroring darwin:

```ts
const WIN_TARGET_RE =
  /^win:(outlook|onenote|fs):[A-Za-z0-9_\-]+:(msg|note|file)-[A-Za-z0-9_\-\.\+]+$/
```

Runtime rules beyond regex:
1. Non-string/empty → throw.
2. `macos:`/`linux:` prefixed ids → throw wrong-platform error.
3. `msg` ids: hex-only, length ≥ 8.
4. `file` ids: base64url must decode to a **relative** path — reject drive letters, leading `\`/`/`, UNC, `..` segments.
5. Brand applied only inside `validateTargetId`; `readOne`/`writeOne` re-validate on consume.

## C. File-by-file change list

### New files

**`companion/src/host-use/win/adapter.ts`** — `export class WinHostAdapter implements HostAdapter` + `getWinAdapter()` singleton.
- Constructor DI: `constructor(opts?: { runner?: PsRunner; fsOps?: FsOps })` — unit tests never spawn PS or touch real fs.
- `listReadTargets(kind, options)`: `mail-inbox` → `runPs("outlook-list.ps1", ["-Limit", String(limit)])` → parse `{ids}` → re-validate each. `file` → fs listing of allowlisted roots (files only) → encode ids. `note` → throw not-implemented.
- `readOne(targetId)`: re-validate; vault blacklist check; `msg-*` → `outlook-read.ps1` → `{sender: SenderName (never SenderEmailAddress), subject, date_received, body_preview}`. `file-*` → metadata only (`file_path`, mtime). `note-*` → throw not-implemented.
- `writeOne(targetId, payload)`: `create` → require `win:onenote:` prefix → `onenote-create.ps1` → `{target_id, undoable:true}`. `move` → require `win:fs:` prefix; validate `source_path` + `destination` both inside allowlisted roots (`path.resolve`, case-insensitive prefix check, `fs.realpathSync` on parent); `fs.rename`, honest `EXDEV` error. `update`/`delete` → throw darwin-mirroring errors.
- `validateTargetId(raw)` per §B.

**`companion/src/host-use/win/blacklist.ts`** — mirrors darwin:

```ts
export const VAULT_WIN_APPS: ReadonlySet<string>  // win.1password, win.bitwarden, win.keepassxc, win.chrome, win.edge, win.firefox, win.brave, win.terminal, win.powershell_ise, win.metamask, win.exodus, win.ledgerlive, …
export const READ_ALLOWED_WIN_APPS: ReadonlySet<string>  // exactly {"win.outlook.classic","win.onenote.desktop","win.fs"}
export function isVaultApp(app: string): boolean
export function isReadAllowed(app: string): boolean
```

**`companion/src/host-use/win/powershell.ts`** — only place PS is invoked:

```ts
export type PsRunner = (script: string, args: string[], opts?: { timeoutMs?: number }) => Promise<string>
export function resolveWinScript(name: string): string   // staged → dist → src; CMSPARK_WIN_SCRIPTS dev-only override (production-disabled)
export const runPs: PsRunner  // execFile("powershell.exe", ["-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-File", script, ...args], {encoding:"utf-8", timeout})
export function parsePsJson<T>(stdout, label): T
```

LLM-controlled values travel **only as argv**; no `-Command`, no string interpolation.

**`companion/src/host-use/win/scripts/*.ps1`** — four scripts; contract: exit 0 + single-line JSON stdout; error → non-zero + stderr; `0x80040154` → stderr prefix `CLASSNOTREG:` → TS maps to `WinAppNotAvailable`.

1. `outlook-list.ps1 -Limit N` → `{"ids":[…]}` via `GetDefaultFolder(6)`, `Items.Sort("[ReceivedTime]", $true)`, StoreID-scoped slug + EntryID.
2. `outlook-read.ps1 -TargetId <raw> [-MaxChars N]` → `Session.GetItemFromID` → `{sender: .SenderName, subject, date_received, body_preview}`. No address fields.
3. `onenote-create.ps1 -Name <n> -Body <b>` → `GetSpecialLocation(2)` → `CreateNewPage` → `UpdatePageContent` XML-escaped → `{"target_id":"win:onenote:unfiled:note-<id>","undoable":true}`.
4. `hello-verify.ps1 -Nonce <n> -Reason <r>` → WinRT `UserConsentVerifier` via AsTask reflection; exit codes: 0 verified (+echo nonce), 3 `HELLO_UNAVAILABLE`, 4 cancelled, 5 other. TS switches on codes.

**`companion/src/host-use/nonce.ts`** — `generateManualNonce()` (Crockford-alphabet generator moved verbatim from `darwin/index.ts:150-161`).

**Tests** (§E) + this plan doc.

### Edited files

| File | Edit |
|---|---|
| `companion/src/host-use/win/index.ts` | Replace stub: `hostRead(params)` mirroring darwin (default `win.outlook.classic` → vault → whitelist → `outlook-read.ps1` top-1). Export `tryWindowsHello(toolCallId, reason)` → `{ok:true;nonce}` / `{unavailable:true}` / `{cancelled:false}`. |
| `companion/src/host-use/types.ts` | `BiometricResult.method` += `"windows-hello"`. Add `WinAppNotAvailable`, `WinPathOutsideAllowlist`. Neutralize `NotImplementedOnPlatform` message. |
| `companion/src/host-use/host-adapter.ts` | Update TargetId contract comment: win format now defined (COM-based). |
| `companion/src/host-use/darwin/index.ts` | `generateLinuxNonce` → re-export `generateManualNonce` from `../nonce` (keeps linux-nonce test import green). |
| `companion/src/security-confirmation.ts` | `PendingConfirmation` += `nonceChallenge?: string`, `nonceAttempts: number`. `respondFrom(..., nonceResponse?)`: challenge set + approved → mismatch: attempts++, send `security.confirmation.nonce_retry {confirmation_id, attempts_left}`, keep pending, return false; 3rd mismatch → resolve denied + log; match → normal resolve. `MAX_NONCE_ATTEMPTS = 3`. |
| `companion/src/server.ts` | ① `resolveHostUseApp` platform-aware: win32 defaults host_read→`win.outlook.classic`; host_write create→`win.onenote.desktop`, move→`win.fs`. ② host_write case admits win32. ③ Adapter dispatch win32→`getWinAdapter()`. ④ Biometric dispatch: darwin→TouchID; win32→`tryWindowsHello`; `{unavailable}` → `generateManualNonce()` + `securityConfirmations.request(..., nonceChallenge)` → method `manual-nonce`; cancel → denied (no fallback). ⑤ `executeCompanionTool` gains optional `sendConfirmation` param; call site passes ws-bound sender. ⑥ Synthetic targets win32: `win:onenote:default:note-default` / `win:fs:default:file-source`. ⑦ `handleSecurityConfirmationResponse` passes `msg.nonce_response` into `respondFrom`. ⑧ `security.biometric.verified` log unchanged. |
| `companion/src/bridge/tool-definitions.ts` | host_read/host_write descriptions platform-neutral (macOS Mail.app / Windows classic Outlook / Linux pending; OneNote create + file move within Documents/Desktop/Downloads). Schemas unchanged. |
| `companion/src/llm/adapter.ts` | Rule 12 platform-aware via `os.platform()`: win32 text describes Outlook read / OneNote create / file move, New Outlook unsupported, writes need Hello or typed code. Keep "NEVER for browser-DOM" + "ask user first per thread" verbatim. |
| `companion/src/host-use/win/RUNBOOK-phase0.md` | Header addendum: spike evidence stands for UI-driving; COM data paths implemented on this branch → points to plan doc. |
| `companion/package.json` | Add `"stage:win-scripts"` copying `src/host-use/win/scripts/*.ps1` → `dist/host-scripts-win/`. |

**Explicitly untouched**: everything in `chrome-extension/`; `thread-approvals.ts`; `security-policy.ts`; `history/store.ts` redaction; `tool-schemas.ts`; ws-auth; darwin/linux behavior.

## D. Security parity checklist

| # | Invariant (darwin/linux ref) | Windows preservation |
|---|---|---|
| 1 | LLM `security_token` stripped before L2 gate | Unchanged — tool-agnostic path. |
| 2 | L2 interactive confirmation unless auto-approve/god-mode/thread-trust | Unchanged — gate platform-blind. |
| 3 | Token binding can't diverge (`bindingPayloadFor`) | Unchanged — win app tokens flow through same helper. |
| 4 | Thread trust: reads only, never writes | Unchanged — key `(threadId, appString, "read")`; win tokens are strings. |
| 5 | **All writes biometric per call** | win32: Windows Hello (real biometric, OS-hosted, unsigned-safe). Fallback when hardware absent: W9 manual-nonce (6-char, paste-blocked) — the Linux downgrade blessed in Round 2 §2.3. Downgrade logged via `method`. Never ask-once. |
| 6 | Vault blacklist; god-mode cannot bypass | `win/blacklist.ts` mirrors both sets; vault→whitelist order; adapter re-checks on consume. |
| 7 | Read whitelist | `READ_ALLOWED_WIN_APPS` = exactly 3 tokens. |
| 8 | Nonce bound to tool_call_id, audit-logged | Same `security.biometric.verified` event `{tool_call_id, kind, nonce, method}`; nonce generated in TS, echo validated from subprocess. |
| 9 | TargetId brand via validator; consume re-validation; cross-platform forged ids rejected | §B rules; adapter mirrors darwin. |
| 10 | No LLM string reaches shell interpreter | argv-only PS (`-File` + args); base64url ids re-validated after decode; OneNote XML escaped in-script. |
| 11 | History redaction | Unchanged — already in `SENSITIVE_CODE_TOOLS`. |
| 12 | File content reads stay out of host_read | win `file` metadata-only; content via MCP filesystem. |
| 13 | Origin-bound confirmations | Nonce request through same `securityConfirmations.request`; validation inside `respondFrom` after origin check. |
| 14 | Auto-approve/god-mode audit | Unchanged. |
| 15 | Subprocess timeouts | `runPs` 15s default; hello 60s (darwin parity). |

**Hardening W-1 (deviation, disclosed):** fs move restricted to `Documents/Desktop/Downloads` under `%USERPROFILE%` (darwin Finder move unrestricted). Rationale: no TCC-equivalent OS prompt on Windows for raw fs; blast radius capped by construction. Junction/symlink mitigated by realpath on parent + `..` rejection; residual TOCTOU accepted (local-attacker model).

## E. Test plan

Runner: **node:test** via `tsconfig.test.json` (verified 27/27 green baseline).

**`companion/tests/host-use-win-adapter.test.ts`** (~15 tests, injected fake runner + fsOps, zero spawns): validateTargetId accept/reject matrix (wrong-platform, unknown app/kind, empty account, non-string, `file-` decoding to `../x` or `C:\x`); listReadTargets re-validation incl. forged id injection; readOne forged id / vault app / stderr surfacing; writeOne prefix checks, allowlist escape → `WinPathOutsideAllowlist`, update/delete throws; `CLASSNOTREG:` → `WinAppNotAvailable`.

**`companion/tests/host-use-win-blacklist.test.ts`** — vault set coverage; `READ_ALLOWED_WIN_APPS.size === 3`; whitelist rejects non-vaulted unknowns.

**`companion/tests/host-use-win-nonce.test.ts`** — challenge stored; correct resolves; wrong → `nonce_retry` + pending retained; 3 wrong → denied; non-origin socket rejected before nonce logic; case-insensitive match.

**`companion/tests/host-use-win-hello.test.ts`** — exit-code mapping with fake runner: 0+valid JSON → ok; echo mismatch → throw; exit 3 → unavailable; exit 4 → cancelled; spawn ENOENT → unavailable (downgrade, not crash).

**Regression**: full `npm test` green.

**Manual verification on real Windows**:
1. Classic Outlook + Defender current: run ps1 scripts directly — no guard prompt, correct 4-tuple.
2. New Outlook only (this machine): `host_read` → `WinAppNotAvailable` with browser-fallback message.
3. Hello-enrolled machine: dialog shows; cancel → denied; success → log `method=windows-hello`.
4. VM (DeviceNotPresent): host_write → 6-char code dialog; paste blocked; 3 strikes denied; correct → OneNote page in Unfiled Notes; log `method=manual-nonce`.
5. E2E extension: thread-trust checkbox for `win.outlook.classic`, never for host_write.
6. File move within Documents OK; to `C:\Windows\Temp` rejected.

## F. Build/run commands (verified)

No `.nvmrc` — system node v24.15.0. Run in **Git Bash**:

```bash
cd /c/Users/HuChen/Projects/cmspark/companion
npm run build
npm test
# equivalent if npm not on PATH:
node node_modules/typescript/bin/tsc -p tsconfig.test.json
node --test $(find .test-dist/tests -name 'host-use-*.test.js')
npm run dev
npm run stage:win-scripts   # new
npm run build:exe
```

## G. Risks & explicit NON-goals

**NON-goals:** 1) UI-driving (UIAccess+EV genuinely required; spike evidence stands). 2) New Outlook automation (no COM; MS Graph = separate product decision). 3) Sending mail via COM (guarded + abuse surface; no platform implements mail writes). 4) Sticky Notes plum.sqlite (undocumented, corruption risk). 5) EV cert / Authenticode / MSIX / installer. 6) update/delete payloads (darwin parity). 7) Completing Linux writeOne. 8) note listing/reading (create-only, darwin parity).

**Risks:** R1 Object Model Guard prompts when AV stale/disabled — mitigated by unguarded-fields-only + docs; residual 10-min Allow window documented. R2 Hello `RequestVerificationAsync` untested on real hardware — fallback absorbs. R3 EntryID drift on cross-store move — accepted. R4 junction/TOCTOU — see W-1. R5 PS 5.1 quirks — `-NoProfile -NonInteractive`, single-line JSON contract, `[Console]::OutputEncoding=UTF8`. R6 manual-nonce assurance < biometric — challenge over paired HMAC localhost WS; same trade-off Linux W9 accepted (Round 2 §2.3). R7 (H1) Hello→manual-nonce downgrade emits a dedicated `security.biometric.downgrade {tool_call_id, reason}` audit event (implemented in server.ts at both downgrade sites). R8 (H4) threat-model statement: nonce challenge confidentiality is same-level as the L2 dialog and relies on the paired extension renderer being trustworthy — a compromised renderer that can read the challenge could already click "允许"; other loopback peers cannot see the challenge and, per A1, cannot burn attempts.

## H. Adversary questions

1. **Tier-collapse on biometric downgrade**: W8 says ALL writes biometric; Linux nonce blessed only because Linux lacks biometric hardware. On Windows Hello usually exists — does availability-checked automatic downgrade re-open the "降级到 ask-once" hole (Round 2 §2.3)? Should fallback require explicit per-user opt-in config?
2. **fs allowlist escape**: NTFS junctions, hardlinks, Turkish-İ case folding, 8.3 short names, realpathSync failure modes — concrete bypass or proof by check-order enumeration (decode → reject `..` → resolve → prefix → realpath parent → rename)?
3. **COM guard audit**: classify every COM member touched vs Object Model Guard protected set. Does `GetItemFromID` on a meeting item expose `Respond`? Any member that prompts regardless of AV or silently grants more than read?
4. **Nonce-channel confidentiality**: challenge plaintext over paired localhost WS — what stops an already-paired malicious local process / compromised extension renderer from reading `nonce_challenge` and self-approving? In scope given god-mode already trusts renderer, or needs audit event + doc statement?
5. **Confirmation-path proliferation**: `executeCompanionTool` gaining `sendConfirmation` creates a second prompt site (previously only `createToolExecutor`). Does this weaken originWs binding / CRITICAL_API_GATE / "one gate to audit"? Would routing nonce through the existing L2 dialog (single dialog carrying `nonceChallenge`) be strictly safer?

---

## Amendments (adversary-mandated, 2026-07-17) — OVERRIDE main text where conflicting

Source: `windows-host-use-adversary.md` verdict `PLAN CORRECT WITH MANDATORY AMENDMENTS`.

1. **(MUST-FIX, A1 — originWs)** Any nonce confirmation request initiated inside the executor path MUST call `securityConfirmations.request(send, details, { originWs: ws })`. ws-bound `send` alone binds only the outbound direction; without `originWs` any loopback WS peer can burn the 3 nonce attempts (DoS). Existing L2 call site (`server.ts:436-451`) never passes originWs — do not copy that omission. Test "non-origin socket rejected before nonce logic, attempts not consumed" is mandatory.
2. **(MUST-FIX, A2 — allowlist prefix boundary)** The fs-move allowlist check MUST be: `resolvedLower === rootLower || resolvedLower.startsWith(rootLower + path.sep)`, applied TWICE — once to the `path.resolve` result and once to the `fs.realpathSync(parent)` result. Bare `startsWith(root)` is rejected (admits `Documents2`, `Documents-evil`). Tests must include `Documents2`/`Documents-evil` escape-rejection cases.
3. **(MUST-FIX, A3 — single-dialog nonce routing)** For the NORMAL path (L2 dialog will show): probe Windows Hello availability BEFORE the `createToolExecutor` L2 gate; when unavailable, attach `nonceChallenge` to THAT SAME L2 confirmation request (the extension already implements inline nonce in the L2 dialog, `App.tsx:299-377`). The standalone executor-internal nonce prompt is retained ONLY for the skip-L2 path (god-mode / auto-approve) — there it is the sole remaining user gate and IS required (biometric tier runs unconditionally inside the executor, `server.ts:1297-1318`). `tryWindowsHello` cancel → denied, never fallback. This overrides §C server.ts ④⑤ wording.
4. **(NIT, A4 — log semantics)** nonce mismatch / lockout MUST log dedicated `security.confirmation.nonce_retry` / `security.confirmation.nonce_locked` events; a false return from `respondFrom` must not be recorded as `security.confirmation.origin_mismatch_or_unknown` (`server.ts:1007-1017`).
5. **(NIT, A5 — regex)** Tighten §B regex to match runtime rules (base64url alphabet has no `+`; hex has no `.`), or add a comment that rules 3/4 backstop it.
6. **(NIT, A6 — vacuous vault recheck)** In `win/adapter.ts` add a comment: TargetId grammar already restricts app to the 3 read-allowed values, so the readOne vault re-check is a defensive vacuous check; do NOT replicate darwin's app-segment string reconstruction.
7. **(DOC, H1/H4)** §G Risks gains: (a) Hello→manual-nonce downgrade emits a dedicated `security.biometric.downgrade {tool_call_id, reason}` audit event; (b) threat-model statement: "nonce challenge confidentiality is same-level as the L2 dialog and relies on the paired extension renderer being trustworthy".
