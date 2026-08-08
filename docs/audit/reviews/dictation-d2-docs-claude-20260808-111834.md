I have enough evidence. The patch is current (matches HEAD vs base e6d659f), pure-logic tests pass, ADR-024 file exists. But manual inspection of the integration path reveals two blocking correctness bugs in the D2 hold feature, plus an explicit disclaimer that the implementation was never executed.

---

## Independent Review — `dictation-d2-docs`

**Patch freshness**: confirmed — `git diff e6d659f` stat matches the .patch file exactly (19 files, +697/-6). HEAD `556efbd` is the implementation commit.

**ADR-020 capability declaration**: present in implementer prompt (Surface L0 / Compose pack / Autonomy n/a / Trust reuses v3 / Channel community). Capability axes fit; no new "中层 Agent"; Pack is forbidden from setting hotkey via `VOICE_FORBIDDEN_KEY_RE` extension (companion/src/packs/types.ts:268). Origin fence regex on companion side is correct (companion/src/voice/dictation-hotkey.ts:42). Trust monotonicity OK — `holdStart` reuses v3 ack gates.

**Pure-logic tests**: `hotkey-chord.test.ts` 4/4 pass; `dictation-hotkey.test.ts` 2/2 pass. Origin-deny, bad-version, Win+V ban, bare-fn ban, default chord parse — all verified.

### Blocking issues

**1. `chrome-extension/src/sidepanel/App.tsx:583-592` — useEffect dependency on `voice` object identity kills every hold within ~250ms.**
The effect's dep array includes `voice`. `useVoiceInput` returns a fresh object literal on every call (`useVoiceInput.ts:714-743`), so `Object.is(prevVoice, nextVoice)` is always false. During any listen session, `setListenTick` is fired by setInterval every 250ms (`useVoiceInput.ts:140, 154-161`), which forces an `InputArea` re-render → `voice` identity changes → the cleanup at `App.tsx:574-582` runs:
```ts
if (down) { voice.holdStop(); notifyHold(false) }
```
This terminates the hold while the user is still physically pressing the key. New effect attaches with `down=false`; subsequent `keyup` is a no-op (`App.tsx:556`). Hold is unusable.

**2. `chrome-extension/src/sidepanel/hooks/useVoiceInput.ts:683-689` — `queueMicrotask` races with `toggle()`'s async permission query and always clobbers the hold state.**
`toggle()` (called synchronously by `holdStart`) gates the actual start behind `navigator.permissions.query().then(begin)` (`useVoiceInput.ts:497-513`). `begin()` is what eventually dispatches `USER_TOGGLE_START` and reads `modeRef.current` (`useVoiceInput.ts:533`). The `queueMicrotask` scheduled inside `holdStart` runs before that promise resolves; at that moment `sessionRef.current.phase` is still `"idle"` (no `setSession` has committed — `dispatchEv` is downstream of `begin()`). The "still idle → restore" branch therefore fires unconditionally, setting:
- `holdSessionRef.current = false` → later `holdStop()` returns false at line 696, so keyup cannot stop the mic.
- `modeRef.current = savedModeRef.current` (`"classic"`) → when `begin()` finally reads it at `useVoiceInput.ts:533`, it starts a CLASSIC 45s session, not the "continuous" session promised by the `holdStart` docstring (line 666-667) and required by the user guide ("按下 → 开始连续听写管线").

Net effect of bugs #1+#2: hold either dies in ~250ms (cleanup path) or starts an unstoppable 45s classic session (microtask path). Either way, broken.

**3. No execution verification for a T2 mic-control-plane change.**
`docs/meeting-and-dictation-user-guide.md:950` explicitly states "实现侧不代跑；合入后由你本地验收。" ("implementation didn't run; verify locally after merge"). Combined with bugs #1 and #2 — both of which would have been caught by a single ~3-second hold-to-talk smoke test — this is a process defect on a T2 blast-radius change to the mic control plane.

### Non-blocking nits (do not block on these)

- `companion/src/message-router.ts:1934` — `require("node-notifier")` inside the handler hot path is cached by Node after first call, but moving it to a module-top-level `import`/`require` would be cleaner and matches the pattern in `menu-bar-agent.ts:30`.
- `companion/src/voice/dictation-hotkey.ts:7` — `lastHoldActive` is process-global; acceptable for single-extension use but worth a comment.
- `chrome-extension/src/sidepanel/hooks/useVoiceInput.ts:738` — `holdActive: holdSessionRef.current` is captured at render time and is not reactive; not currently consumed by `App.tsx`, so cosmetic.
- `companion/tests/dictation-hotkey.test.ts` — no explicit `bad_version` (`v: 2`) test despite the handler having that branch.

### Verdict

Bugs #1 and #2 are blocking correctness defects in the D2 hold feature; bug #3 is the missing verification that would have caught them. Pure-logic unit tests pass but exercise neither the React effect lifecycle nor the async permission path where both bugs live. The docs/capability/pack-fence portions of the diff are fine; the implementation of the hold feature itself is not shippable.

VERDICT: REJECT
