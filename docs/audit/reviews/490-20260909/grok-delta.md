# Independent delta review — CMspark #490

**Base:** `aada096a`  
**Surface:** T2 panel-only follow-up (production UI + tests). No backend after the already-reviewed `organizing` boolean / 19→20 gate.  
**Evidence class:** static read of the provided `KnowledgeGraphApp.tsx`, `explorer.ts`, UI harness, and artifacts `[inspected]`. PASS logs and JSON are treated as implementer-executed, synthetic Chrome — not Windows / real corpus.

Prior Grok `APPROVE_WITH_NITS` and DeepSeek `APPROVE` are not inherited.

---

## Prior findings vs this delta

| Prior claim | This packet | Result |
|---|---|---|
| P2-1 controlled `<details open={n<=19}>` resets on hover/search | `details-toggle.json` + UI test: collapse@4 and expand@20 survive query+hover; `locked20` keeps open and unlock sends `unlock_group` | **Disproven** on this React/Chrome. Unchanged boolean `open` is not re-forced. Crossing 19 still flips the prop (new snapshot — acceptable). |
| P2-2 resize always `fitView()` | `userCameraRef` → pan `+= Δsize/2`; else fit | **Fixed in source.** Math keeps world-point-at-center and scale. |
| P2-3 fit once before layout; 191/200 | Fit every frame while `!userCamera && simTicks < 320`; pan/zoom/select set `simTicks=999` | **Fixed.** `initial-200-frames.json` + `after.json`: 200/200 centers, 20 frames. |
| P2-5 failed lock/LLM clears organize busy | `onActionResponse` only sets error; `sendOrganize` restores `confirmedOrganizingRef` | **Fixed.** UI log: lock/naming failure keeps 「整理中…」; failed new organize returns to idle. |
| P1 pointercancel capture leak | Trusted CDP: down→gotcapture→move→cancel→lostcapture; later unpressed moves do not pan | **Disproven.** Matches Pointer Events implicit release. Cancel ≠ click is correct. |
| One-way `requestError` | `applySnap` always `setRequestError("")` on parse | **Disproven.** |
| Hung companion as P1 | UI checks `lastError \|\| ok===false \|\| sent===false`; rebuild poll 40×2.5s; organize 35s | **Out of claimed scope.** Send-layer + bounded waits only. |
| matchMedia / titles / relatedEdges / `type=button` / DESIGN header | matchMedia once per canvas mount; `titleByIdRef`; `relatedEdges` `useMemo`; 「知道了」 is `type="button"` | **Addressed.** `graphStyles` is **module-scope**, not per-render alloc (old nit was wrong). |

P2-4 (legacy companion with no `organizing`; 35s local busy) is still true and **declared**. Old servers cannot authoritatively busy-signal. Not a new regression.

---

## Outcomes vs DoD (this delta)

| Claim | Result |
|---|---|
| 1/4/20/200 paint, full list, honest zero-edge | Met (`after.json` visible=N, list count=N, 「暂无明确关联」) |
| Auto-fit until stable; all 200 centers on-canvas | Met (frames 1–20 visible=200) |
| User pan/zoom/selection stops sim | Met in source (`simTicks=999`, `userCameraRef`) |
| Custom camera survives list toggle / resize | **Source correct.** Test PASS claimed; see NIT on artifact. |
| Unrelated send fail ≠ clear organize; failed organize rolls back | Met |
| Keyboard / pointercancel | Met with real keys + trusted touch |
| Details persist; unlock@20 reachable | Met |
| No auto-organize; naming pref retained; no new verbs | Met |
| #491 | Not claimed |

Trajectory still T2: same `knowledge_graph.refresh` / `open_doc` / `ack_tf_switch`. Default `llm_labels` off. Collision pruning is canvas labels only.

---

## Findings

### P0 / P1
None.

### P2
None that break #490 on this evidence.

### Nits

**NIT-1. Camera artifact vs invariant.**  
Production resize path is the right formula (`pan += Δ/2` iff `userCameraRef`). `camera-preservation.json` still shows `xFromCenter`/`yFromCenter` moving with bitmap size on 1440/960/390 (e.g. 116.98 → 196.98 at 1120×671, which is exactly *no* pan adjust from 960). The wait only checks “current offset equals the original,” **not** that CSS/bitmap size has changed, so it can pass on a pre-RO frame. List-toggle row at width 1280 with the original offset is the one sample that actually looks like the new path. Tighten: wait until `c.width` matches the expected post-reflow size in the same evaluate, then assert offset. Do not treat this JSON as proof of viewport preservation.

**NIT-2. Residual busy fiction.** 35s client timer can still lie if a completion push is lost; `applySnap` heals when a snapshot arrives. Legacy companions remain idle-looking. Documented; do not advertise “job state always matches server.”

**NIT-3. Fit pads radii, not title line.** `sy+17 < h` still drops canvas labels. List remains a11y SoT; centers are the 200-node contract.

**NIT-4.** 「取消选中知识」 still has no `type="button"` (no form — cosmetic). 200-row list still unvirtualized (cap 200).

---

## Component correctness

- **Canvas lifecycle:** `[showCanvas]` + RO/rAF cleanup; error unmount stops frames; remount paints. Unchanged and still the blank-canvas fix.
- **Explorer:** `filterKnowledgeNodes` list-only; layout/draw use full payload. Holds.
- **Camera:** auto path refits until settle; user path freezes sim and (in source) preserves center on reflow. `fitKnowledgeCamera` can zoom out (`(w-96)/extent`), which is why 200 centers fit.
- **Busy:** `confirmedOrganizingRef` is the last parsed `organizing === true`; fail-closed parse. Correct for the send-layer contract.
- **Trust:** no new message types, no search→organize, refresh default-off unless saved pref.

Out of scope unchanged: #491, `user_gesture` e2e, summoner deny, ≥20 TF `group_key` (backend already reviewed).

---

VERDICT: APPROVE_WITH_NITS
