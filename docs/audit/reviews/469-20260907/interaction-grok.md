I'll read only the packet and follow its review instructions independently.The packet is truncated; I'll load the review skill and continue reading the rest of the packet.The packet assigns this lane to me, so I’ll keep reviewing it rather than dispatching other reviewers. Continuing through the rest of the packet.The assigned lane is this review itself (inspect only the packet), so I’m not dispatching other reviewers. Findings below are from the packet only.

# Interaction review · CMspark #469

Independent PRODUCT-UX / CORRECTNESS / SAFETY gate. Inspected only `packet.md`. Base `8656df94`, uncommitted scoped files as frozen in the packet.

**Packet hole (limits certification, not a product defect):** the shell of the redesign is not in the packet — `WorkspaceFrame`, `workspace-styles`, `StatusRail`, `SettingsSlideout`, `ComposerDock`, ContextPanelHost height CSS, ToastHost positioning, FocusBand. Machine harness claims are taken as claimed, not re-executed. Findings below are only from code that *is* in the packet.

---

## P2 — History group chevron is a dead control

Timeline month / day / 今天 / 昨天 headers moved `onClick` off the row and onto a text `<button>`, but left the `▼`/`▶` `<span>` as a **sibling**, not inside the button.

Mouse users still aim at the chevron (the actual expand affordance). Clicks there do nothing. Label click still works; keyboard `aria-expanded` still works. This is a lost mouse affordance introduced by the a11y conversion, repeated four times.

## P2 — Nested interactives added to satisfy keyboard

Design contract: no nested interactive elements.

1. **Thread rows:** parent `<div onClick={handleSelect}>` remains; title is now a real `<button>` that `stopPropagation`s. Clickable container + inner button.
2. **Tool cards:** expand control is now a `<button>` whose `stopPropagation` implies the parent header/card still toggles on click.

Keyboard paths work (and the harness checks them). The parent click wrappers should have been removed or demoted to non-interactive layout, not left in parallel.

## P2 — Thread title name lies in select / trash

New control: `aria-label={`打开 ${accessibleName}`}` always. `handleSelect` in select mode toggles selection; in trash it no-ops. Accessible name says open.

## P2 — Empty history copy points at a control this surface no longer owns

Unchanged empty string: `暂无线程，点击「+ 新建」`. Design moved new conversation to WorkspaceNavigation as `新对话`, and forbids a second header new-thread control. History empty state now instructs a missing `+ 新建`.

## P2 — History Escape is document-global

While the non-modal history portal is open, any `Escape` `preventDefault`s and either closes the ⋮ menu or the whole list and focuses the trigger.

It does not ignore inner fields beyond that menu, nor other layers (context panel also listens on `window`; confirmation handlers must stay byte-unchanged). Two listeners can fire. History is `aria-modal="false"` at `zIndex: 10050`, so it can visually cover a pending `alertdialog` while Tab still reaches `允许` / `拒绝`. Overlay-vs-confirmation is partly pre-existing; the new global listener and auto-focus into the portal make the collision more likely.

## P2 — Terminal chrome selects by DOM position

`TerminalApp` styles the header as `.cm-terminal>div:first-of-type`. Contract: new classes explicit; do not infer role from positional selectors. Inserting any node before the header breaks the 480px wrap. Primary “确认内容并发送到 CMspark” is also `min-height: 34px` vs the 36px primary-action rule.

---

## NIT

- History dialog: visible title 「历史对话」 vs `aria-label="历史对话列表"`; no `aria-labelledby`.
- Tool name stays 11px; design chrome is 12–13 (card body went to 12).
- Tags/topics group headers are not in the truncated diff; timeline-only keyboard conversion may be incomplete.
- Harness “200% equivalent” is a 720×450 viewport, not zoom; it never asserts 220px nav, 780px conversation cap, 36px send, or settings-while-panel-open.
- Search autofocus uses `input[type="text"], input:not([type])` — `type="search"` would miss. Harness never asserts search focus.

---

## What looks intact (from packet + claimed harness)

- Confirmation: still production `alertdialog`; 允许/拒绝/停止 hit-tested; no `security.confirmation.response` on render. Toast slot moved **below** FocusBand so toasts are not claimed to paint over the gate. No FocusBand handler/DOM diff in packet.
- Stop / 纠偏 / 排队 / offline 重新连接 / composer disable still present. `chat.abort` path unchanged. L2 still opens Cockpit. No backend/policy files in scope.
- 新对话 in nav is asserted to emit `thread.create` only, not `chat.send`.
- Narrow `导航` drawer: labeled, focus in dialog, Escape restores trigger (implementation not in packet; harness passed).
- Attach not removed; moved into `cm-composer-actions`. Send fill is charcoal `actionPrimary`, matching the contract (not indigo slab).
- Suggestions remain fill-vs-send in existing empty-state mapping (handler not changed in the diff).
- No new production dependency in scoped files.
- Terminal review copy still refuses to treat submit as “tests passed”.

---

## VERDICT: **APPROVE_WITH_NITS**

No P0/P1 confirmed in the provided code: confirmation is not implicitly approved, stop is not removed, primary send/nav/history keyboard paths that the harness covers still exist.

Do not treat this as certification of the IA shell (`WorkspaceFrame` / tokens-only Cockpit / native). Merge is not blocked by a demonstrated confirmation or stop regression. The P2s above should be fixed or explicitly deferred: dead chevrons, nested click wrappers, “打开” vs select/trash, stale `+ 新建`, history Escape scoping.
