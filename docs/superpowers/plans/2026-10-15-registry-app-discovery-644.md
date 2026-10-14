# Implementation plan — Registry app candidates #644

GitHub: https://github.com/nehcuh/cmspark/issues/644 · Parent: #70 candidate 3
Spec: ../specs/2026-10-15-registry-app-discovery-644.md
Status: R2 CONTRACT APPROVED / SOURCE CANDIDATE — root authorized implementation; independent source/native/delivery gates pending.
Base:36827c849633239811e7437e8452729a35aafb6e. R1/R2 contract history is preserved. The execution gates below remain mandatory; local results do not approve this author’s source.

## 1. Goal

Implement only the frozen local Registry discovery/provenance slice; make it independently verifiable without changing adding/launching authority. Preserve every original boundary listed in the spec; parent #70 templates/CLI/Hello/presets/drift/GUI/platform work remains independent.

## 2. Planned files and ownership

- `companion/src/host-use/win/scripts/apps-enumerate.ps1`: bounded Registry read and literal extraction within existing zero-argv script; keep running/StartApps extraction and single-line JSON.
- `companion/src/apps/enumerate.ts`: registry candidate and validated optional summary; detailed helper with existing array-return wrapper.
- `companion/src/apps/handlers.ts`: detailed default Windows enumeration and safe metadata response; retain annotations and all apps.add logic.
- `chrome-extension/src/sidepanel/types.ts`: candidate registry source + typed summary.
- `chrome-extension/src/sidepanel/store/agentStore.tsx`, `hooks/useWebSocket.ts`: candidate-view summary projection/clear only.
- `chrome-extension/src/sidepanel/components/AppsPanel.tsx`: explicit registry badge and bounded fixed limitation notes, existing selection/add flow unchanged.
- Focused new/affected Companion enumeration/handler tests, native integration fixture/script, actual App DOM producer test/recording; `.github/workflows/ci.yml` narrowly register native Windows fixture without changing platform skips or existing gates.
- This spec/plan and a short user-facing discovery-range explanation, only after implemented result is known.

No generic registry library/framework/dependency/helper executable. Preserve active parent35/533/563 source; later rebase/compose against delivered main rather than whole-file replacement. In particular AppsPanel/hooks/store may share other UI work; use actual minimal deltas and full hash manifests. Planning originally changed only these two documents. The authorized source candidate now follows this plan; no delivery/native acceptance is inferred from the design.

## 3. Ordered execution after contract gate

### Gate A: freeze contract and real source baseline

Root reviews all finite grammar/bounds, local path proof/reparse guard, optional summary/legacy contract and native fixture cleanup before any implementation. Address concrete contract findings as document increments; do not treat this author's proposal as approval. Record issue644 body hash, base/source hashes, clean index and exact two document hashes. Preserve current old639 branch ref and known ignored/untracked dependency symlink; no reset/clean/stage dependencies.

After root authorization, inspect current main/owned diff and choose narrow source branch; public dependencies/locks unchanged. Classify any need to amend child issue contract before implementing scope changes. Read actual enumeration/parser/handler/UI call chain; snapshot fixed deadline/buffer/guard constants. Do not obtain a local Windows result by default-app/VM/config changes.

### Gate B: production-derived RED, no fabricated payload contract

Add small permanent tests before product changes:

- Native Windows integration creates private owned directory/inert regular `.exe`/`.dll`/`.ico`/directory/missing-path fixtures, exact UUID-suffixed HKCU Uninstall children and nonce ownership marker in each needed explicit view. Records only fixed test case names/owned projections/counts/status/hash. Never reads an actual user's private registry/app corpus for model use. Existing CI runner inventory stays process-private.
- Execute actual production `apps-enumerate.ps1` through actual existing runPs/WindowsPowerShell5.1 and actual enumerateApps. Original producer has no registry rows and parser does not accept registry: relevant expected cases fail. Do not pretend local macOS run created native Windows RED; if native RED only runs in the later CI gate, preserve that temporal fact. No new CI run is authorized by this planning phase.
- Unit contracts use actual parser/detailed helper and actual extracted production functions with controlled registry reader/byte seams. Use real serialized owned producer output for field/value shape assertions. Initial source/TS/JSON failures remain preserved; test setup/compiler failures are not product RED.
- Add actual App badge/summary/legacy controls based on genuine producer recording. Failure before React settles is not evidence; use meaningful awaited state and no source-string-only UI assertion.

### Gate C: smallest producer/parser/UI implementation

Implement read-only scoped Registry view enumeration and pre-read byte bounds. Native interop is fixed literal source in existing script, max4096 key names and no raw-sized allocation/retry. Open/dispose handles safely; reset in/out byte/character sizes per API call. Normal missing entries/unsupported types/invalid literals omit candidates. Access errors/oversized metadata/budget limits create fixed bounded incomplete summary. Whole Add-Type/script/transport/exit/JSON errors reject unchanged.

Implement exact conservative quoted/unquoted grammar; no uninstaller/location/environment expansion/arguments. Reject remote drive/namespace/reparse before probing leaf regular-file existence. Do not broaden general add-flow/signer policies. Preserve existing sources then sort bounded Registry snapshot and dedupe; actual escaped UTF-8 JSON cost before append. Candidate cap/byte cap cause partial note, not hidden truncation, malformed output or a retry. Include **aggregate** original16MiB stdout UTF-8 envelope accounting: baseline old shape plus escaping, summary, all braces/brackets/commas and actual existing emitter encoding/newline/preamble. Reserve summary before admitting Registry bytes via min(1MiB, remaining original total space); independently prove final total<=16MiB and incremental/final serialization cost equivalence. Old rows never clip and no old-source cap is added. When only fixed OUTPUT_LIMIT partial summary fits, keep old rows with zero Registry additions; when even that necessary summary cannot fit, emit exact old-only shape/no-summary=unreported. Baseline already over16MiB retains original rejection. No new global buffer or deadline. Retain explicit non-atomic/current-snapshot limitation.

Add registry source and safe summary across actual detailed producer→handler→WS→reducer→App badge, old array wrapper unchanged. No global cached diagnostics, second scan or status inferred from old response. Clearing candidates clears summary; old/malformed summary is null/unreported, not unavailable. Existing current paired App route/add-flow/guard/cap/Hello rules remain. Avoid adding ordinal/source ranking into authority or promoting metadata into model tools/knowledge.

### Gate D: focused proof and source freeze

Meaningful controls and expected results:

| Lane | Required assertion |
| --- | --- |
| Real Windows5.1 collector | owned quoted spaces/CJK/commas/index and unquoted no-whitespace local file emitted; source registry; explicit view coverage; existing source precedence and duplicate policy |
| Literal negatives | DLL/icon/directory/missing/relative/UNC/device/ADS/env-relative/args/invalid UTF-16/type/control/remote or reparse reject; UninstallString/InstallLocation do not influence accepted identity or execute |
| Bound primitives | before-allocation query over cap rejected; grows between size/data returns partial without retry; key/candidate/escaped-byte and whole16MiB envelope exact boundary correct, including actual encoding/newline/summary/comma overhead; old-near-limit plus Registry stays within total; no-summary-room preserves exact old-only output; old-over-limit still rejects; no truncation/retry/budget increase |
| Partial and legacy | complete requires no reasons; partial requires finite reason(s) and permits zero new rows, including OUTPUT_LIMIT; unavailable has access/read reasons only and no Registry rows; contradictory/duplicate/unknown summary is null; no raw path/key/error/env data; no-summary fallback/old protocol remains unreported, never fake complete; no stale note after clear/new legacy response |
| Existing admission | ISE/LOLBIN hard deny; vault restrictions, signer/hash/canonical duplicate and unsigned/user-writable caps remain; no effective token/launch/Hello interaction in fixture |
| Actual UI | real producer-derived registry badge + limitation note; explicit human selection still creates existing apps.add request; no autonomous selection/add/launch/config writes |

Future byte-bound tests must use the actual serializer/producer functions and retain emitted bytes, not just a formula or fake handwritten result. Include L+summary+new bytes equal to original limit, one byte over, UTF-8 CJK/quotes/backslashes, actual PowerShell5.1 newline/preamble cost, no first-row room but truthful OUTPUT_LIMIT note fits, no necessary-summary room old-only fallback, and L already too large. Compare all old rows unchanged through actual parser and no-summary nullable projection. A controlled actual execFile writer proves transport behavior only; native small fixture separately pins real emitter wire overhead. Preserve the original independent synthetic allowed-shape RED (16,744,248-byte old success versus16,912,640-byte append overflow) without relabeling it Windows/native or an actual installed-app population.

Native fixture cleanup is strict owned-only finally: retain original current key handle/view and exact generated root-relative child path, verify nonce marker before deletion, delete only that child (not Uninstall root or preexisting key), close handles; delete only its private temp directory while safely handling owned junction leaves. Creation uses create-if-absent (collision refuses, never overwrites an existing key), and records which views actually created a key. Shared HKCU32/64 aliasing must not make cleanup delete an unrelated key or invent two independent native stores. Assert fixture keys/files absent after cleanup; original installed keys untouched. Fixture failure remains failure, no retry/skip, no plaintext registry inventory/log/personal environment dump.

CI ordinary fixture is small. Large-cap/fault cases use actual production helpers with declared controlled delegates; do not create thousands of installed keys or claim those helper tests prove all real Registry denial/timing states. Native tests must verify actual PowerShell5.1 edition/version through private process assertions, runPs resolves native System32 runner and no profile/-Command path. Fail if the intended native Windows lane cannot execute; retain current established non-Windows test-selection convention honestly, do not mark it native proof or change old skips. Exact native fixtures cannot be replaced by a pwsh7 result.

Commands after implementation, using Node22 via nvm and existing canonical runner (file names frozen when source exists):

1. `npx tsc -p tsconfig.test.json` in Companion, exit0.
2. `node scripts/run-tests.mjs .test-dist/tests/<enumeration-family>.test.js .test-dist/tests/apps-handlers.test.js .test-dist/tests/apps-add-flow.test.js .test-dist/tests/apps-guards.test.js .test-dist/tests/apps-ise-guard-70.test.js` — selected actual affected cases0fail/cancel; honest existing-platform skips.
3. On actual Windows CI, canonical native integration file invokes actual collector/runPs/enumerateApps. Native cases0fail, owned cleanup/assertions passed and exact source/head hash recorded.
4. Extension `npx tsc -p tsconfig.test.json`, selected actual UI producer/reducer tests, real actual-App fixture with uv+existing interpreter; no dependency download/default Chrome/profile. Exit0 without page errors; recordings label controlled transport versus real native accurately.
5. Both build commands `npm run build`, exit0. `git diff --check` covering new/untracked owned paths through a private index or parent's exact staged gate, not just tracked files. Preserve original failures and every raw receipt.

Never invent counts/paths/commands as completed now: angle-bracket future test names above are planning placeholders, finalized source manifest must provide exact runnable paths. Tests that use process/reader/Chrome seams disclose them. Parent shared full machine/fresh locked ARM/named judges reuse unchanged evidence only when source hashes justify it; this author does not self-approve.

### Gate E: independent/source/model/native head/main delivery

Freeze complete scoped source/diff/manifest/report plus all real RED/GREEN logs, source/lock hashes and test classifications. Non-author independently attacks parsing/cap/type/local-path/partial/authority boundaries with production payloads. Concrete P0/P1/P2 must be repaired and re-reviewed; no green count overrides a failure. Root owns grouped full machine/fresh locked ARM/full Kimi/configured Claude (weekday no Pi), exact head all required jobs, native Windows5.1 proof and exact merged-main CI. Publish PR with Closes#644/Refs#70 only after those gates; no parent70 closure from this slice.

## 4. Non-goals and constraints

Do not implement other #70 candidates, app parameters/CLI/Hello/drift/UIA/background GUI, broad preset trust, remote/recursive inventory, installers, elevated writes or blanket platform skip removal. Do not change deadline/buffer/config/scanner/default apps. Existing root35/533/641 source/evidence stays frozen. No real app launches/effective grants/personal credentials/native business operations. No claim that metadata guarantees a main executable or discovers all portable apps. Source gap already confirmed; planning is not delivered feature/native acceptance.

## 5. Context and remaining decisions

Full linked issue644 and prior #70 diagnostic are the source of scope; see spec official sources and `/tmp/cmspark-70-registry-current-contract-diagnosis.md`. Current code uses array parser/runPs, annotations and global candidate view, so optional truthful summary requires small actual WS/store/UI projection; it cannot be bolted on as shared mutable diagnostics. Numeric ceilings, conservative grammar, embedded bounded APIs/local-reparse checks and safe summary were explicitly reviewed as contract assumptions. R2 non-author contract acceptance and root authorization are recorded; source acceptance and native/delivery gates are still pending, without a new user permission question.
