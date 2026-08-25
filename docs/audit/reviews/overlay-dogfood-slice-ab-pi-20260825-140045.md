All verification complete. Here is my review.

## Dual external review — overlay-dogfood-slice-ab (direction lock)

### Diff reality check
The patch is **docs-only** (a direction-lock spec + the review prompt itself; 134 insertions, no code). `git status` confirms nothing else is staged; the patch matches `HEAD` (`2dee37a`), not stale. This is a legit direction review, not a code review.

### Factual claims in the spec — verified against real code (all accurate)

| Spec claim | Verification |
|---|---|
| Mac tray opens Swift NSPanel locally | `Tray.swift:374-379` — `MenuTag.summoner`/`summonerHotkey` → `summonerController.open` (native), while every other action forwards to Node via `jsonLine(["type":"click",...])`. Dual-shell lie is real. |
| 🎙/attach hidden on Mac | `SummonerOverlay.swift:921` `micButton?.isHidden = true`; `:909` `attachButton?.isHidden = true`. |
| C-thin HTML has `<input type=file>`, no mic | `summoner-web.ts:577` `<input type="file" id="files" multiple>`; no `getUserMedia`/`voice.stt`/`knowledge.*` anywhere in the file. |
| HTML allowlist clean | `summoner-web.ts:18-32` `SUMMONER_WEB_DISPATCH_ALLOW` = ping/chat/thread/mcp/pack/file.upload/lease only. No knowledge.*, no voice.stt.*, no confirm. |
| Node `handleAction("summoner")` → HTML | `menu-bar-agent.ts:1302` `openSummonerWebShell` → `openLoopbackPage`; `:1346` `case "summoner"`. |
| `marked.parse` no breaks | `ChatView.tsx:1534` `marked.parse(content, { async: false })` — only a katex extension registered; breaks defaults false. Bug confirmed. |
| `meetingCard` always accentSoft | `PacksPanel.tsx:1579` static `background: tokens.accentSoft`; conditional logic only toggles the apply/✓-modOn button (lines 917-930), never the card background. Bug confirmed. |

### REJECT conditions — all respected
- **R1** (ACL/knowledge/confirm/getUserMedia/voice.stt growth): no growth — current allowlist verified clean; slice explicitly keeps it clean and bans `knowledge.list`.
- **R2** (workbench merged into radio): respected — meeting card stays a workbench entry with a separate conditional apply button; fix is background-only.
- **R3** (unfreezing AppKit while shipping C-thin): the opposite happens — Swift stays frozen and is *further* unreachable from menu/hotkey. No NSOpenPanel, no unhide 🎙.
- **R4** (sidePanel.open / fake-open): explicitly banned in F-UX-OVERLAY-1 and §1.
- **R5** (Raycast/Project/graph): absent.

### The "stay-on-Swift?" question
Darwin→C-thin is the **correct** honesty fix. The Swift panel is not merely missing features — it actively hides attach+mic at the code level (`909`/`921`), so Mac users structurally cannot attach files. Fixing that would require unfreezing AppKit = the R3 fork (second product, double maintenance). The HTML already has the lease/conductor-gated `file.upload` path; routing Mac through the same shell is consistent with C-thin P3's "same HTML is the cross-platform wrap" and F-UX-OVERLAY-1. Stay-on-Swift would leave the honesty bug unfixed.

### ADR-020 checklist
- **Declaration**: present in both prompt and spec (Surface L0 overlay + Side Panel; L2-classes none; Compose pack-highlight UI only + knowledge USE via thread ids; Autonomy n/a; Trust no ACL growth/no getUserMedia/no confirm; Channel unchanged). Accurate, matches the diff's actual blast.
- **Axes fit**: yes — surface honesty + UI polish; no new tools/gates; no "中层 Agent" language.
- **Pack-first**: meeting workbench stays distinct from pack radio; pack highlight is UI-only. ✓
- **Trust monotonicity**: HTML allowlist unchanged; `file.upload` already lease+conductor gated; no confirm. ✓
- **originWs**: n/a — no new `securityConfirmations.request`.

### Nits (non-blocking, none are forks)
1. **Spec §3.3 wrong data source for the optional hint**: it says the "本对话已挂知识" line may read from existing `thread.select` — but `thread.select`'s `thread.messages` response (`message-router.ts:2115-2125`) does **not** include `active_knowledge_ids`. The data is available via `thread.list` (already allowlisted; `listWithPreviews` spreads the full Thread incl. `active_knowledge_ids`, `thread-manager.ts:680-714`). Reword the spec so the implementer uses `thread.list`, or the hint silently can't be built (which would be fine, but the spec should say so).
2. **Hotkey registry ambiguity**: `Tray.swift:377-379` routes the hotkey to Swift's panel + `showHotkeyPicker`/`noteHotkeyConfigured`, while Node has a parallel `summoner/hotkey.ts` registry (`menu-bar-agent.ts:74`). Spec says "热键 → 同一份 C-thin HTML" but doesn't state which registry owns the hotkey now. Clarify to avoid a two-hotkey divergence.
3. **Frozen-but-reachable code**: keeping `SummonerOverlay.swift` plus the `summoner.dictate/settings/hydrate/tool` bridge commands (`Tray.swift:559-596`) unreachable is fine for this slice, but deserves a tracked cleanup ticket so the frozen path can't silently re-grow as a second product.

No blocking issues. The direction is the minimal, honest next step; every factual premise checks out; all five reject gates hold; capability declaration is present and consistent.

VERDICT: APPROVE_WITH_NITS
