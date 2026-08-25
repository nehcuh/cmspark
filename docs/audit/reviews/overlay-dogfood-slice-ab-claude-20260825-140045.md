## Dual external review — Overlay dogfood Slice A+B (DIRECTION)

**Patch freshness** [executed]: the diff file matches current `git status`/staged state exactly (2 new docs, no code) — not stale. This is genuinely a direction lock, no impl yet.

### Code claims — all verified [inspected]

| Spec claim | Code reality |
|---|---|
| Mac menu opens Swift locally | `Tray.swift:374-379` — `summoner` tag → `summonerController.open()`; hotkey too (`handleSummonerHotKeyPressed` → `openFromHotKey`, Tray.swift:1409-1416) ✓ |
| 🎙 hidden in Swift overlay | `SummonerOverlay.swift:921` `micButton?.isHidden = true`, tooltip “听写暂未开放” (1239) ✓ |
| C-thin HTML has file input, no mic | `summoner-web.ts:577` `<input type=file id="files" multiple>`; no `getUserMedia` anywhere in file ✓ |
| DISPATCH_ALLOW clean | `summoner-web.ts:18-33` — no `knowledge.*` / `voice.stt.*` / confirm ✓ |
| `marked.parse` no breaks | `ChatView.tsx:1534` — the **only** parse site in the extension (streaming + settled share it); DOMPurify already allows `br` (1537) ✓ |
| meetingCard always accent | `PacksPanel.tsx:1575-1580` unconditional `accentSoft`; `activePackId` already in scope (917); note the pack `<li>` row (995) currently has **no** active highlight at all — only the “本对话使用中” label + button swap ✓ |
| Knowledge USE via thread ids real | `thread-manager.ts:28` / `skill-engine.ts:576` (`active_knowledge_ids`) ✓ |
| F-UX-OVERLAY-1 as quoted | knowledge-honesty spec line 82 ✓ |

### Direction judgment — Darwin→C-thin is right

The status quo is a real dual-shell lie: Mac tray opens a Swift NSPanel with hidden mic and no attach, while Win gets the HTML shell with 📎. The C-thin spec (2026-08-24, dual-approved) already locked "C-thin, not more Swift" and "freeze AppKit growth." Slice B completes that arc: one honest shell (📎 visible, mic honestly absent + hint), Swift frozen-but-not-deleted (reversible). The alternative — stay-on-Swift and add NSOpenPanel attach — would violate the AppKit freeze and double maintenance. No fork here.

### R1–R5: none triggered. ADR-020 checklist: clean

Declaration present and accurate (L0 / none / UI-only / n/a / no trust growth / channel unchanged). Pure Surface-axis; no new pack, no confirm family, trust stays monotonic (overlay strictly weaker), no `originWs` surface touched, no new runtime. Overlay freeze is *strengthened*, not weakened. Test seams exist (`companion/tests/summoner-web.test.ts`, `summoner-overlay.test.ts`, `summoner-hotkey.test.ts`).

### Nits (non-blocking)

1. **Swift rebuild ritual**: Slice B edits `Tray.swift` → must rerun `build-tray.sh` and update `SWIFT_TRAY_SHA256` in `swift-tray-bridge.ts` (per project A8); spec's impl-order section omits it.
2. **Mac tests will need updates**: `summoner-hotkey.test.ts` / `summoner-overlay.test.ts` likely assert the current Mac-opens-Swift behavior; rerouting the menu/hotkey means updating those assertions, not just adding HTML-side ones.
3. **Dead hydrate flow on Mac**: post-reroute, `summoner.ready/hydrate` stdout from Swift becomes unreachable; also the IME-composing hotkey guard (Tray.swift:1411-1413) loses its subject. Spec already says Swift code stays — fine — but impl shouldn't leave Node waiting on `summoner.ready` before doing anything on the Mac path.
4. **Slice A optional knowledge hint**: “本对话已挂知识” depends on what `thread.list/select` already returns to the HTML shell; if knowledge ids aren't in that payload today, skip the optional item rather than widening the payload.
5. Spec table row 2 says the fix is in `ChatView.tsx` — correct file, but worth noting the single parse site covers streaming too, so no second flag is needed (impl might double-apply; harmless).

VERDICT: APPROVE_WITH_NITS
