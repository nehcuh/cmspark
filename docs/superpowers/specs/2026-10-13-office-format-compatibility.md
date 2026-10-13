# Office import compatibility

GitHub: [#611](https://github.com/nehcuh/cmspark/issues/611)
Date: 2026-10-13
Baseline: 3705f5da3f51a11b3c0bdf581e39737ed306d275

## Observable behavior

Explicit chat attachments, knowledge previews, native file selection and authorized directory import support DOC/XLS/PPT/ODS/ODP alongside all existing formats. The source filename, MIME and byte length remain the user-facing identity. Meeting references retain their DOCX/MD/TXT contract and existing size limits.

DOC/XLS/PPT become DOCX/XLSX/PPTX through pinned `@deepseek-ai/libreoffice-kit@0.1.5`; ODP becomes PPTX to avoid the confirmed officeparser omission. ODS uses officeparser directly. Normalized archives are checked again before parsing and image extraction. Conversion does not call `recalculate`; this is not a guarantee that LibreOffice never updates any document cache while importing/exporting.

Office body text retains numeric paragraphs and repeated lines. Data image URIs remain stripped from Markdown; attachments are extracted separately with byte/count limits. Unsupported WPS/ET/DPS suffixes produce an actionable save-as-standard-format error, without renaming or speculative compatibility retries.

PDF low-text pages gain a bounded local Kit rendering path, preserving the ten-page ceiling. A render-only result is explicitly marked `requiresVision`. Knowledge ingestion refuses such results rather than storing placeholders. Chat requires at least one actual successful vision result before sending render-only content as an extracted document, and warns about page limits/partial analysis. No new OCR models or online conversion are introduced.

## Boundaries and lifecycle

Known suffixes infer MIME only for empty/generic supplied MIME. The verified Linux WPS PDF alias `application/wps-office.pdf` is canonicalized to `application/pdf` before authorization and parser dispatch, including equivalent entries in allowed types. Explicit unknown MIME remains subject to existing authorization. Chat adapts only a list whose normalized set exactly equals the old default MIME set; custom subsets/supersets and unrestricted empty lists keep their meaning. This adaptation is performed at the authorization boundary without editing cached or on-disk live configuration. New-install defaults include the five supported formats.

The parser owns a single default 30-second budget and forwards cancellation from chat. The compatibility adapter propagates AbortSignal, awaits converter disposal before deleting its private directory, and restricts native/WASM operations to two active slots with bounded pending admission. Officeparser also receives cancellation and a bounded await. This timer cannot interrupt arbitrary synchronous JavaScript parser work; ODF repetition expansion therefore needs its own preflight work budget. Temporary input/output names are generated inside private caller-owned directories, never taken as engine paths from WS parameters.

Input remains 10 MiB. Converted Office output is capped at 32 MiB; ZIP declaration totals at 100 MiB with bounded entry count; image inflation at 8 MiB per image and 16 MiB total. Page images have explicit page/pixel/dimension and output-byte bounds. Traversal, NUL, symlink, malformed expected ZIP containers, resource limits and aborts are refusals, not compatibility fallback triggers.

ODF preflight also checks the actual container MIME and main content, then limits relevant XML to 8 MiB, XML/expanded nodes to 100,000, column iterations to 50,000, expanded text to 8,388,608 UTF-16 code units and depth to 128. Repetition counts must be positive safe integers; budgets accumulate across tables and sheets. Legitimate repeated blank ODS tail rows retain the upstream constant-work exception. Nested ODS tables, repeated embedded objects and multiple references to the same resolved embedded object are refused where expansion cannot be safely estimated. These are explicit compatibility limits, with a split/save-as error instead of silent truncation. XML bytes are checked before inflation; node/depth checks occur after DOM construction and do not guarantee a hard DOM memory ceiling.

Embedded ODF charts also charge attribute-sourced values, repeated dataset names, dataset × label broadcasts, separators and retained copies against the shared text/node budgets. Branch selection uses the original first 500 bytes, matching the dependency. Ordinary charts with embedded data remain supported; ODS chart range references and mixed OOXML charts embedded inside ODF are explicit refusals. This avoids an unbounded cross-document range/cache expansion fallback.

## Distribution

Kit remains an external filesystem sidecar, loaded through development or executable-relative require. Ship its two workers, matching platform engine, normal and matching optional transitive dependencies, sources and notices. Node minimum becomes 22.19; distribution runtime is pinned to verified 22.23.2. Both shell packaging and legacy Windows SEA staging use one helper. Linux uses the published WASM engine; Windows retains its VC++ v14 prerequisite and actionable unavailable errors. No installer elevation or live configuration change is part of this work.

## Validation and gates

This is one atomic compatibility batch: engine, format admission, lifecycle and shipping changes are mutually required before the new formats can be published. Mandatory checks: meaningful text/numeric/repeated-body fixtures; ODP failure regression; input/ZIP/image limits; cancellation and cleanup; custom allowlist behavior; one chat and native knowledge route; PDF render-only knowledge refusal; relocated staged sidecar conversion; host checks; arm64 Linux WASM container with declared fonts; all existing CI plus three-OS conversion/staging smoke.

The diagnosis mapped ten subsystem lanes through three bounded parallel workers, then six cross-cut lanes after a barrier, then independent synthesis. No confirmed P0 was found. P1 findings: missing reachable formats, lost Office body text, abandoned cancellation, absent PDF canvas runtime, missing native distribution. P2 required shipping work: resource budgets, notices, prerequisites and real conversion coverage. Refuted: Kit lacks cancellation/archive bounds; current historical zip-slip comments establish a reproduced current RCE; process separation is an OS sandbox.

Kimi full-diff review, machine checks, independent adversary, Pi rereview, arm64 container and green CI gate merge. Machine assertions take precedence over review prose.

## Capability declaration

Blast: T3, untrusted explicitly uploaded documents enter an additional native/WASM importer.

```text
Surface: L0 explicit attachments, native selector, already-authorized directory
L2-classes: unchanged; no new path grant or caller-selected engine paths
Compose: local conversion → current parser/media → existing vision gate
Autonomy: user-triggered import only
Trust: authorization unchanged; refused containers stay refused
Channel: existing Companion WebSocket; no new listener
```

No outbound profile/MCP changes, WPS compatibility claim, meeting scope expansion, GPU OCR deployment, automatic formula recalculation or release publication. Complex business-document fidelity remains a separately observable acceptance concern, not a promise inferred from synthetic fixture success.
