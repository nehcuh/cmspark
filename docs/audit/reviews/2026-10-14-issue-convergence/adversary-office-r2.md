# Independent Office component adversarial review r2

VERDICT: APPROVE (component only; not release/merge approval)

Reviewed only the 20-path Office group (#614 / #615 / #616). I implemented the separate CI stdio component and do not approve that component here. No Office implementation edits, dependency changes, commit, push, live configuration changes or business-document access were performed by this review.

## Exact source identity

Read the complete Office diff and its numbered/actual source context from context-r2.md, plus adjacent unchanged parser, thread persistence, model-history reconstruction and UI reducer code. Independently decoded the exact manifest and calculated SHA256 of every Office file in both the original worktree and frozen combined repo:

- /Users/huchen/.codex/worktrees/office-font-warnings/cmspark: 20 checked, zero mismatches.
- /tmp/cmspark-convergence-wave-20261014/repo: 20 checked, zero mismatches.
- /tmp/cmspark-office-batch-full.diff: f6d1816747e7257695470b36401d0b7fad5ad665d4fd3ab7b222820c397feffd, matches full 20-file implementer packet.
- Manifest tracked-diff identity df44c68452df77fbe17cdf13daf288f296b869be5d73c1e4992b3e9e27504c62 is a distinct artifact (tracked diff versus full diff with new files), not a source divergence.

## Independent checks performed

Using Node 22.23.2 after nvm use 22 against the frozen compiled repo:

1. Canonical isolated Companion runner over odf-expansion, file-parser-safe-name and office-import-entry: 34/34 PASS, zero skipped/failed/cancelled, 1.929 seconds. Full log /tmp/cmspark-office-adversary-r2-host.log.
2. Frontend document-warning test via its actual React/store/WS helper imports: 3/3 PASS, zero skipped/failed/cancelled. Full log /tmp/cmspark-office-adversary-r2-ui.log.
3. Separate actual-producer fork probe: used recorded actual chat.user producer metadata, real ThreadManager addMessage, actual handleMessage(thread.fork), then a fresh ThreadManager disk reload and actual rebuildMessagesFromHistory. Notice survived the fork and disk reload; model history contained neither warning string nor files field. Explicit fork alias prevented title gateway calls, model credentials disabled, only test-owned temp data used and deleted. Full log /tmp/cmspark-office-adversary-r2-fork.log records actualFork/noticePreserved/diskReload/modelRebuildNoticeAbsent/noGatewayCall all true.

Parent's whole-host inventory card states 5901 tests / 5849 PASS / 52 existing platform skips / 0 failures/cancellations, frontend 1527/1527 and both builds exit 0. This review does not relabel those as independently rerun full-suite evidence. Linux ARM64 and fresh CI are pending, so neither is green in this verdict.

## Findings / attack-path checks

No confirmed P0/P1/P2 defect found in the reviewed Office delta.

### Warning propagation and content separation (#614)

- Production parseFile conversion warning is an existing fixed message, produced only from actual converter missingFonts; normal parser return text remains separate. Router forwards normalized ordinary conversion notices in finalFileContents.warning, and chatCreate persists them in message.files then sends that metadata in chat.user. Limit is 512 warning characters, 256 filename characters, at most 20 notices; no raw missing-font inventory or converter paths are exported.
- chatCreate document XML is assembled from file.content, and rebuildMessagesFromHistory projects user history only to role/content. New files is not spread into canonical model messages. Router knowledge preview/extractor and knowledge import receive loaded.text/parsed.text, not warning; actual producer test asserts subsequent model inputs and persisted knowledge body lack the warning.
- Warning follows disk JSON persistence. Actual thread.fork branch copies files without altering body or image sidecar remapping. Independent fork/reload/history probe verifies this new continuity path rather than relying solely on the source line.
- Live chat.user handler parses notices through the whitelist; hydration applies the same whitelist. Same-ID echo and optimistic-ID adoption preserve notices when a later SW echo omits files. ChatView memo comparator now includes files so adding metadata can redraw the row. Thread switching uses existing per-thread transcript state and guard; foreign live events are rejected.
- Both knowledge preview producers supply bounded warning metadata. WS helper whitelists warning separately from payload; reducer only attaches it to a matching reply, clears it on a fresh request/uncorrelated sentinel and rejects closed/late replies. Phase-two suggestions preserve the current parse warning without transferring it into body.
- DocumentWarning renders plain React text with role=status, never raw HTML. SSR hostile img/onerror input is escaped and bounded. Empty/malformed notices disappear. KnowledgeImportModal and user MessageRow both call the same component.
- Render-only document coverage remains in the pre-existing vision evidence text path and is explicitly not reclassified as ordinary conversion-warning metadata. This is a deliberate evidence distinction, covered by the producer test.

### XML refusal and resource guard (#615 maintenance)

The only production resource-guard change is a try/catch directly around new DOMParser(...).parseFromString. DOM warning/error/fatalError still refuses; xmldom wrapping that refusal in English is normalized to the fixed Chinese XML-damaged error. Namespace checking, object references, total bytes/nodes/depth, repeated cells/text and chart cost enforcement occur outside the catch and retain their original failures. There is no permissive fallback, no budget increase, no namespace exception and no converted-success laundering.

Tiny synthetic XML tests call the real locked OfficeParser and parseFile for spaces/newlines/bare frames/main-versus-embedded chart behavior. The two-sheet column-boundary probe is explicitly synthetic, uses real parser output, and externally bounds process runtime/old-space. Its timings/RSS are observations, not representative business throughput or a hard process-RSS cap. The existing namespace/resource/chart negative controls passed independently with the new malformed-XML producer cases.

The actual authorized representative large multi-sheet business corpus remains unavailable. #615 must remain open for that acceptance requirement, or retain an explicitly open external-blocked child requirement; it cannot be closed as universal real-world Office compatibility by this component approval.

### Paths, MIME and authorization (#616)

No production temp-path algorithm or upload admission is changed by this group. The maintenance corrects a misleading test assumption: host path.basename does not universally strip Windows separators on POSIX. Real parseFile already uses a unique private temp directory and generated input.<sourceExt>/normalized.<targetExt> paths rather than the original upload basename. The new I/O seam actually observes write/converter paths and cleanup, while an explicit controlled converter refusal tests error propagation. That seam is not mislabeled as native conversion success.

Empty extension with explicit known MIME retains the existing fallback; malformed/unknown nonempty suffix does not trigger speculative conversion or a retry. ZIP/conversion/cancellation/resource refusals are not caught into text success. The generic MIME tests call actual router admission and confirm application/octet-stream and binary/octet-stream allowlist entries do not authorize an inferred PDF/DOCX/DOC/ODS format; specific custom allowance still governs. Historical-default exact-set ambiguity is documented honestly, without mutating live cached/on-disk config, and arbitrary custom subset/superset restrictions remain in controls.

## Outcome, trajectory and component DoD

- Outcome: #614 notice transport/display/persistence and #616 scoped contract maintenance work under independent actual-producer and UI checks. #615 fixed Chinese DOM refusal and bounded synthetic producer coverage work; its real business-corpus requirement is still blocked.
- Trajectory: prior wrong fixture assumptions and the original grouped Native Office 240-second failure are retained in the packet. The precise native timeout phase was not observed. The later full-inventory serial native run is current host evidence; neither source nor native timeout was changed to obtain it. No invented root cause or synthetic-to-real promotion is approved.
- Component DoD: implementation, focused regressions, source identity and the reviewed full-host machine card are adequate for this Office component. Fresh Linux, complete independent batch gates, exact-head CI and landing rules remain parent-owned requirements. This verdict does not approve any other group's changes, close externally blocked #615, close #618/#626 enterprise acceptance, or grant merge/release permission before those gates.
