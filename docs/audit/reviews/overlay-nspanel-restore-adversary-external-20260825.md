# Adversary review (External / spec-honesty) — NSPanel restore vs locked Slice B

**Batch**: `overlay-nspanel-restore-20260825`  
**Role**: independent spec-honesty skeptic (did **not** implement)  
**Evidence**: `[inspected]`  
**Blast**: T2 lock SoT.

Locked direction spec (still **LOCKED** on disk): `docs/superpowers/specs/2026-08-25-overlay-dogfood-slice-ab-design.md`  
Direction dual both AWN: `overlay-dogfood-slice-ab-verdict-20260825-140045.json`  
Impl dual both AWN (HTML Darwin): `overlay-dogfood-slice-ab-impl-verdict-20260825-142137.json`

---

## Q1 — Locked spec vs tree; user override vs dual lock

The Slice A+B design file still says **LOCKED**. No later spec marks it **SUPERSEDED**. Locked Slice B: Darwin menu/hotkey → C-thin HTML; Swift freeze (no NSOpenPanel, no unhide 🎙).

Tree is the **inverse**: `Tray.swift` `summonerController.open`; `handleSummonerHotKeyPressed` → `openFromHotKey`; tests assert NSPanel not `"action": "summoner"`; `NSOpenPanel` + unhidden mic.

**User override is necessary and not sufficient.** Oral “I don’t want Chromium `--app`” is a reason to **write a new lock**, not a license to invert the old one while leaving `状态: LOCKED` and a both-APPROVE impl verdict on disk.

**Pick: REJECT** this batch until a new spec is dual-locked and `142137` is stamped STALE.

---

## Q2 — “Raycast/uTools 形态” honesty

**Not honest.** Titled+closable 640pt NSPanel + 200pt rail is a mini workbench. Collides with parent F-UX-NOUN-1 (UI 禁 Raycast/uTools) and Slice B §4 **Raycast 重做**. Even as a comment, it encodes a banned noun as the Darwin product story.

---

## Q3 — Stale `142137` APPROVE artifacts

**Blocker for claiming this slice is dual-approved.** Those files still say menu/hotkey → C-thin, overlay untouched, no NSOpenPanel. HEAD is the negation. Minimum before any APPROVE of *this* tree:

1. New direction spec dual-locked; old Slice B marked SUPERSEDED.
2. `142137` stamped **STALE / HTML Darwin only**.
3. New impl dual against the new spec.

---

## Q4 — F-UX-OVERLAY-1 / `knowledge.*`

**Knowledge clause: still held.** Overlay/tray Swift has no `knowledge.list/import/preview/related`. Web dispatch has no `knowledge.*` / `voice.stt.*` / confirm. Attach → `file.upload` only.

**Swift freeze / F-S-5 spirit: broken.** Native overlay now reads files via NSOpenPanel and drives `voice.stt.*` on summoner WS — the “第二条产品” Slice B forbade.

---

## Q5 — Slice A

**Matches locked spec.** `ChatView.tsx` `breaks: true`; `PacksPanel` meeting accent only if `activePackId === "meeting-minutes"`; exclusive list highlight. `markdown-breaks.test.ts` **[executed]** 2 pass. Dual `142137` Slice A DoD remains valid.

---

## Extra

- Tests now **require** NSOpenPanel + visible 🎙 — inverted SoT.
- Dual-shell restored: Darwin NSPanel vs Win/Linux HTML.

VERDICT: REJECT
