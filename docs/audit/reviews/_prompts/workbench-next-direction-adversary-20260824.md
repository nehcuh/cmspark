# Independent adversary — next optimization direction (not code)

Repo: /Users/huchen/Projects/cmspark
You do NOT implement. You pick / kill a direction.

## Product reflection (owner + implementer)

1. Overlay **cannot attach files**. Owner wants attachments. Side Panel has `file.upload`; summoner ACL does not. Overlay "attach" = Chrome, not files.
2. Owner framing: CMspark as **enterprise AI workbench**:
   - Quick summon → talk + apply AI (L0 + Composition)
   - Complex work → browser Side Panel (L1)
   - Non-web deep work → Computer Use (L2)
   Implementer: maps to ADR-020; not three runtimes; overlay is not a full workbench yet.
3. **Cross-platform**: Companion + extension work on Win/Linux/macOS. Summoner UI is **Swift-only**; systray2 `sendSummoner`/`hydrateSummoner` are no-ops. Recent overlay rail / Shift+Enter queue is **invisible on Win/Linux**. Owner: do not over-focus macOS.

## Current WIP

PR #219 `feat/steer-nextrun-overlay-hub`: panel steer/nextRun; overlay Swift rail; overlay-eligible pack.apply allowTrust=false. Code adversary REJECT on drain (later stamped). T2, not merged.

## Your job

Recommend **exactly one next slice** (P0) and list **explicit non-goals**.

Candidate slices (you may reject all and name another):

A. Finish #219 (Pi rereview, merge) then stop overlay work.
B. More Swift features (NSOpenPanel attachments, richer rail) — Mac-only.
C. Cross-platform summon shell (HTML/WKWebView/companion window) + `file.upload` on all three OS; Mac Swift becomes adapter or is frozen.
D. Something else (name it).

Constraints:
- ADR-020: one tool-loop; Trust monotonic; overlay still not Allow/Deny.
- Honest Linux/Windows CU (ADR-018): do not claim L2 parity.
- Blast: T2 unless Trust/file paths force T3.

Write the report path given in your task.
End with:
DIRECTION: A|B|C|D-<name>
then
VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT
REJECT = the reflection is wrong or the slice is unsafe/incoherent.
APPROVE* = you endorse a slice (must pick DIRECTION).
