# Office compatibility #611 — machine evidence

Date: 2026-10-13; baseline: `3705f5da3f51a11b3c0bdf581e39737ed306d275`.
Review source diff SHA-256: `875873f2493d1538c24f8a086241713eb4430bfc8df6a1f0fc6663a229c957fd` (47-file source diff excluding audit reports supplied to reviewers; binary fixtures represented by markers and checked by pinned hashes).
Node 22.23.2, native macOS ARM64; separate Linux ARM64 WASM container pinned to the Dockerfile base digest and exact npm lock with Noto CJK/DejaVu fonts.

## Commands and observed results

- Companion `npm run build`: exit 0; `npm test`: exit 0, 5871 tests, 5819 passed, 0 failed, 52 skipped. The three runner TAP batches are 4326/1525/20 tests. Existing platform/environment skips remain; no new Office skips.
- Extension `npm run build` and `npm test`: exit 0; 1511 passed, 0 failed, 0 skipped; sidepanel hygiene passes.
- Companion `npm run bundle:exe`: exit 0; Kit remains external.
- `node --test scripts/tests/office-runtime-stage.test.mjs`: exit 0, 3 passed, no skips.
- `node scripts/smoke-office-runtime.mjs`: exit 0, actual bilingual DOC→TXT from relocated executable-relative native sidecar, with source module resolution disabled.
- `bash scripts/tests/test-package-gates.sh`: exit 0, 162 passed (distribution worker ledger).
- `bash scripts/validate-office-container.sh`: final frozen patch exit0; TypeScript and real Office/entry/ODF suite43 passed,0 failed,0 skipped; staging3 passed; actual relocated WASM bilingual conversion passed. Log:`/tmp/cmspark-office-final-chart-container.log` (distribution worker ledger).
- Both production `npm audit --omit=dev --audit-level=high`: exit 0; companion 11 moderate, no high/critical; extension zero advisories. Known Kit nested fflate ZIP64 moderate advisory documented and refused before conversion; gate unchanged.
- YAML parsing, shell syntax, `git diff --cached --check`: exit 0.
- Isolated macOS app deep-sign compatibility probe: passed; engine manifest hashes intact (distribution worker ledger). Windows/macOS/Linux GitHub matrix remains required before merge; release pipeline smoke is configured but no release published.

## Observed DoD

- Real pinned DOC/XLS/PPT/ODS/ODP fixtures retain English/Chinese body, original filename/MIME/size. ODP regression normalized to PPTX.
- Repeated and numeric DOCX body retained; both sheets of XLSX/ODS, signed/decimal numbers and stored formula result retained.
- Actual DOC chat and ODP native knowledge routes passed; MIME inference/old defaults/custom/unrestricted lists covered, live config not changed; meeting references retain existing contract.
- Unsafe/malformed archives, central/local/sentinel ZIP64, archive/image budgets refused. Actual running abort and deadline return only after engine disposal, output/temp directories cleaned.
- Real 11-page PDF renders 10 bounded pages and requires vision; both zero/nonzero-offset Buffer uploads pass after genuine Uint8Array normalization. Knowledge refuses image placeholders; chat requires actual vision success and reports partial results.

## Capability / gate card

Blast: T3 (untrusted documents enter another local importer).
Surface: explicit L0 upload/native selector/authorized directory.
L2-classes: unchanged; Compose: local conversion → current parser/media → existing vision gate.
Autonomy: user-triggered imports only; Trust: authorization unchanged; Channel: existing WebSocket.
No WPS compatibility claim, grant/profile expansion, live config edits, formula recalculate calls, meeting expansion or release publication.

MACHINE: PASS
Independent adversary and Pi rereview are required before merge. Kimi full-diff review is also required.

## Regression cases from actual execution

1. Converted ODP rendered visible bilingual text but direct officeparser lost body; verified normalization to PPTX restores text.
2. Earlier cleanup removed repeated paragraphs and digits-only lines; actual fixtures now preserve both.
3. Old PDF.js mishandled Node Buffer, including zero-offset buffers on Linux; genuine Uint8Array copies pass zero/view and page-cap cases on native and WASM validation.
4. Attribution: existing parser heuristics/dependency behavior, found by actual execution. These cases protect document fidelity, bounded rendering and honest knowledge ingestion.

## Confirmed user PDF MIME regression

A locally supplied standard PDF (990877 bytes, 39 pages) was parsed without persisting its body: standard `application/pdf` reached chat admission and produced 20015 characters on both native macOS and Linux ARM64. Changing only MIME to `application/wps-office.pdf` reproduced the exact unsupported-type error at the router and parser on both platforms. This isolates MIME alias admission from PDF content or platform parsing differences.

The minimal fix canonicalizes that exact observed alias before allowlist comparison and parser dispatch, in both frontend ingress and server dispatch. Custom PDF-denying lists still refuse it; equivalent PDF-only lists work; arbitrary explicit MIME and unknown WPS MIME remain refused. The configuration stays unchanged.

The same original PDF and both MIME values passed **three fresh-process trials per platform** after the fix, always yielding 39 pages and 20015 characters. The local reproduction script is `/tmp/cmspark-office-wps-pdf-repro.cjs`; private input paths/content are absent from public artifacts. Permanent regression tests use generated/public fixtures in `office-format-compatibility.test.ts`, `office-import-entry.test.ts` and extension MIME tests. Full machine checks above were rerun after this fix; no user PDF is committed or sent to review models.

Independent warning-delivery nit N1 is assigned to repository maintainer in [#614](https://github.com/nehcuh/cmspark/issues/614). It is a follow-up UI metadata issue; no broader document fidelity claim is made.

## Confirmed ODF semantic-expansion regression

A public/generated 725-byte ODS with 100000 repeated columns produced 1700017 text characters in 190ms despite a 20ms cooperative deadline; the 723-byte single-column control took 2ms. Bounded fresh children used 128MiB heap and an external 1500ms limit. No OOM or production 30-second hang was asserted. Attribution: synchronous dependency expansion blocks JavaScript timers; this protects untrusted document resource admission, not an OS sandbox or arbitrary synchronous hard deadline.

The final batch adds preflight ODF XML/repetition work budgets, validates actual MIME/main XML, refuses ambiguous nested ODS and repeated embedded objects, and preserves legitimate million-row blank spreadsheet tails. Direct xmldom0.9.12 stays bundled and its full MIT license is shipped. The same original 20ms input was refused in three fresh processes (3.94/4.04/4.21ms parser time;43–45ms total). Nine new regression groups cover real-parser refusal/valid repeats, blank tails, malformed counts, row/column multiplication, cross-sheet/XML totals, ODT/ODP, MIME/namespace bypasses, and DOM comments/BOM. Host full suite and a rebuilt exact-lock Linux container were rerun after this fix; all passed as listed above.

Earlier approvals of source SHA661c6ad are superseded by this reproduced blocker. That SHA6aa2b97 was subsequently rejected by Pi; current review identity is875873f, with the additional chart correction described below. Static limits are not a hard wall for every synchronous parser operation. The XML byte limit is checked before inflation, while node/depth counts are checked after DOM construction; they do not bound peak DOM allocation or RSS. Logs: `/tmp/cmspark-office-611-host-tests-final-odf.log`, `/tmp/cmspark-office-611-odf-repro-guard.log`, and `/tmp/cmspark-office-611-odf-final-focused.log` (168 focused tests, exit0).

The independent adversary additionally produced a 753-byte public synthetic ODS with 90 references to the same 100000-character MathML object. It returned 9000028 characters, exposing entry-once accounting despite no row/column repeat attributes. The final preflight refuses duplicate actual object-entry references, including suffix/path aliases and nested-frame repeated visits; the actual-parser refusal and valid single reference are permanent regressions. Independent pre-chart Office/entry/ODF tests:39 passed,0 failed,0 skipped. This records a real missed case and closed defect; the prior guard approval remains superseded.

Final Kimi nonblocking ODF compatibility/warning/comment observations are assigned to maintainer in [#615](https://github.com/nehcuh/cmspark/issues/615); no source edits after hash freeze.

## Gate override — new Pi blocker

Final source6aa2b97 machine checks passed but Pi second confirmation REJECTED the batch: chart `office:value` attribute strings amplify through repeated chart cells/datasets without being charged by the ODF guard. Complete rejected-source report: `2026-10-13-office-611-pi-rejected.md`. That rejected source was not committed or merged; the chart correction now has fresh checks and requires new reviews. High-RSS probe is not repeated by implementers; bounded low-scale public probes protect this boundary.

## Fresh chart correction — source875873f (current machine gate)

Original rejected-source approvals remain revoked. The final guard explicitly models chart attribute values, series names, dataset×label broadcasts, raw entries/separators and retained text/metadata copies. Actual original Buffer head500 matches the dependency's chart branch selection; ODS range references and embedded mixed OOXML charts are explicit conservative refusals. Standard embedded-data charts retain real two-series names/labels/values, and the normal blank-tail exception remains supported.

The independent-before-fix reproductions used only low-scale parsing (512×512chars,128MiB heap/1500ms external child bound) or preflight-only admission for larger expressions. They reproduced attribute-vs-text admission and attribute-free label broadcasting without recreating the high-RSS judge probe. The final public regression corpus now has13ODFgroups; focused13files172tests passed. New full host tests:5871total/5819pass/0fail/52existing skips, exit0 (`/tmp/cmspark-office-611-host-tests-chart-final.log`). Final rebuilt ARM64 Office/entry/ODF:43pass/0fail/0skip, staging3pass and relocatedWASM actualconversionPASS (`/tmp/cmspark-office-final-chart-container.log`). Final productionbundle19.3MiB/--check/--versionPASS and high+auditPASS11moderate/nohighcritical, logs `/tmp/cmspark-office-final-chart-{bundle,audit}.log`. Independent43tests also passed at exact source875873f. No source drift after freeze.

MACHINE: PASS (current source875873f). MERGE: NO pending fresh independent full report, Kimi/Pi rereview and3OSCI. Old verdicts on661c6ad/6aa2b97 do not authorize merge.

## Final source-review gate (before PR CI)

At source875873f: MACHINE PASS; independent adversary APPROVE_WITH_NITS; Pi second-confirmation APPROVE_WITH_NITS; supplemental Kimi APPROVE_WITH_NITS. Complete responses are companion audit reports. Nits assigned to maintainer in #614/#615/#616; no source edits after freeze. MERGE:NO until green three-OS CI. The older Pi rejection is retained as evidence of a fixed blocker, not waived.
