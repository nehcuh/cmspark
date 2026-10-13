# Office #611 — Pi second-confirmation (rejected source)

Date:2026-10-13; Pi CLI0.85.1 configured deepseek/deepseek-v4-flash; command exit0. Full source SHA2566aa2b973a8617759a500adefc5380f50dc0c9b421d7837ef47ed89449a766442. The following complete report overrides previous approvals: MERGE:NO. A new correction and fresh adversary→Pi/Kimi review are required; tests passing alone do not waive the reproduced blocker. Private user PDF was excluded.

## Pi second-confirmation review — #611 final47file, baseline `3705f5da3f51a11b3c0bdf581e39737ed306d275`

READ-ONLY respected: no source/test/git/config/dependency edits; all probe output written to `/tmp/pi-probe/**` only. No subagents.

Source identity verified before review: `git diff --cached | shasum -a 256` → `6aa2b973a8617759a500adefc5380f50dc0c9b421d7837ef47ed89449a766442`, 47 files, equals the reviewed source hash (audit reports are untracked and excluded).

### What I independently reproduced (adversary claims that hold)

- Focused compiled suites at the final SHA with `nvm use 22.23.2`: `node --test .test-dist/tests/odf-expansion.test.js` → 9 pass/0 fail/0 skip; `office-format-compatibility.test.js` → 20 pass/0 fail/0 skip; `office-import-entry.test.js` → 10 pass/0 fail/0 skip = **39/0/0**, matching the machine card.
- MIME alias path (`resolveDocumentMime`): `companion/src/file-formats.ts:44–52`; admission before allowlist at `companion/src/message-router.ts:1666–1691`; parser-side at `companion/src/file-parser.ts:65–67`; custom/unrestricted lists preserved (tested).
- Route selection is not re-sniffed: `fileType` is passed explicitly (`companion/src/file-parser.ts:251`), so `OfficeParser.parseOffice` skips magic-byte re-detection (`node_modules/officeparser/dist/OfficeParser.js:174–201`) — my earlier hypothesis of a guard/parser kind mismatch is closed.
- ZIP path/ZIP64/declared-size gates precede inflation, and inflation is genuinely capped at the declared size (`node_modules/adm-zip/zipEntry.js:104–125`; `node_modules/fflate/lib/index.cjs:2617` `{out: new u8(su)}`), so the "bounded AdmZip inflater" claim is accurate.
- `office:value`-free variants, `text:s` accounting, ODS empty-tail exemption, duplicate-object refusal: guard behaves as documented.
- I do **not** reject on "static limits are not hard deadlines / not a DOM RSS ceiling"; those boundaries are explicitly documented in the spec and I treat them as accepted.

### Concrete missed blocker (P1) — guard-admitted ODF attribute text amplification, budget exceeded by ~3 orders of magnitude

`officeparser`'s ODF chart extractor multiplies an **attribute-sourced** string by `table:number-columns-repeated` and joins it:

- `companion/node_modules/officeparser/dist/utils/chartUtils.js:144,146` — header `colsRepeated` → N dataSets; `:160,161,163` — `val = dataCells[j].getAttribute("office:value") || …` pushed N× into `values`; `:107/233` — `rawTexts.push(...ds.values)`.
- `companion/node_modules/officeparser/dist/parsers/OpenOfficeParser.js:1209` — `text: chartData.rawTexts.join(" ")` (runs unconditionally in the frame→`draw:object` branch, *not* gated by `extractAttachments`); `:1517–1531` and `:1686` — any `Object N/content.xml` containing `chart:chart` is extracted and `assignAttachmentData` joins again.
- The guard charges text only from DOM text/CDATA nodes and `text:s/@text:c`: `companion/src/odf-expansion.ts:143,147,162–169` (MAX_TEXT at `:19,36`). **ODF attribute values are never charged**, so the cross-product `repeats × |office:value|` is invisible to the preflight, while `validateOdfExpansion` is called immediately before `officeparser.convert` (`companion/src/file-parser.ts:224,250–252`; `extractAttachments` derived as `true` because only `includeImages:false` is passed — `OfficeConverter.js:60`).

Measured on the final compiled product code (`.test-dist/src/file-parser.js`, i.e. `parseFile` exactly as shipped), with `Array.prototype.join` instrumented in the probe process only:

| Input | Guard | Observed |
|---|---|---|
| ODT, 925 B (`hn=24000, a=24000, \|office:value\|=16000`) | **ADMITTED** | `BIG-JOIN {entries:72000, totalChars:384312000, sep:" "}` then `{…, sep:"\n"}`; final RSS **844 MB**, 104 ms |
| ODS, 981 B (same payload, no conversion step) | **ADMITTED** | `BIG-JOIN {entries:72000, totalChars:384312000}`; final RSS 463 MB |
| ODT, 8 723 B (`\|office:value\|=8 000 000`, still < 10 MB upload and < 8 MiB XML budget) | **ADMITTED** | `BIG-JOIN {entries:72000, totalChars:192000312000}` → `error: "文件解析失败: [OfficeParser]: Invalid string length"` |
| ODT, 914 B — identical payload moved from the attribute into `<text:p>` | REFUSED (`展开文本`) | — |

So the *only* difference between refused and admitted is whether the amplified text sits in a text node or in an `office:value` attribute. The spec's own contract — "limits … expanded text to 8,388,608 UTF-16 code units" (`docs/superpowers/specs/2026-10-13-office-format-compatibility.md:25`) — is therefore not enforced on this path: 384,312,000 chars admitted (46×), and 192,000,312,000 chars *attempted* (≈23,000×) from an 8.7 KB file. The work is synchronous on the companion main thread (the abort check runs once before extraction), so it stalls the event loop and spikes RSS per upload; `includeImages:false, includeCharts:false` does **not** suppress it (only the `:1209` join remains, still 384 MB — verified).

This is the same defect class as the two reproduced-and-fixed ODF blockers (entry-once object accounting; repetition/column accounting): an ODF resource-admission gap that lets a sub-kilobyte untrusted document drive far more expansion than the stated budget. The DoD item "ODF semantics refusals" and "bounded … rendering/conversion … " are not met, and the adversary's summary claim that "emitted row/column products … are charged" is incomplete in exactly this dimension. N1 (#614) is unrelated and remains correctly assigned.

### Outcome / Trajectory / Component

- Outcome: DOC/XLS/PPT/ODS/ODP reachability, ODP→PPTX body repair, numeric/repeated/multisheet retention, PDF vision honesty, knowledge placeholder refusal, ZIP64/path/image refusals are all consistent with the source and my reruns — **except** the ODF preflight does not bound attribute-driven expansion, so "bounded Office/ODF admission" is false as shipped.
- Trajectory: issue-first, capability card, no WPS proprietary claim, no recalc/grant/config/meeting/release expansion — verified (`recalculate` absent; config file asserted untouched by tests).
- Component: slot/disposal/cancellation, page/pixel limits, staging/integrity/licence/source shipping look sound and are consistent with the machine ledger; the single unclosed component is the ODF text-budget accounting above.

Because the missed blocker is reproducible on the exact reviewed source hash with the exact shipped `parseFile` path, the final47file batch cannot be approved as-is regardless of the passing 39-test focused suite (that corpus contains no attribute-sourced chart payload).

VERDICT: REJECT

(Evidence: `companion/src/odf-expansion.ts:19,36,143,147,162–169`; `companion/src/file-parser.ts:224,250–252`; `companion/node_modules/officeparser/dist/utils/chartUtils.js:144,146,160,161,163,107,233`; `companion/node_modules/officeparser/dist/parsers/OpenOfficeParser.js:1209,1517–1531,1686`; `companion/node_modules/officeparser/dist/OfficeConverter.js:60`; `docs/superpowers/specs/2026-10-13-office-format-compatibility.md:25`; probe outputs above, all written to `/tmp/pi-probe/**`.)
