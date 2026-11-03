# #826 independent bounded initial-input + first-dialog design review

**VERDICT: APPROVE the bounded design with the concrete implementation requirements below. Design only; no source, native/API/UI, CI/dispatch or permission/budget change performed.** Three pre-form fixture startup gaps and FIRST DIALOG are separate supported paths, with no common physical cause inferred.

Read actual current generators/full produced Windows fixtures, host/controller/form sources, Node launch sites, launcher environment, existing scope825 setup contract, first-dialog callbacks and OBS826 inverse. Reused B's10source/14official controls as historical independent evidence; ran the distinct10controlled checks below.

## A. Initial owned caption selection

Actual LOCAL/ARCHIVE `desktopInitialActivation788` and TERMINAL `begin_form` return before form installation when foreground is foreign. Existing product show() already calls SetForegroundWindow. No smaller reliable source-supported focus retry or passive event reorder establishes the user-selection precondition. A single selection of this fixture's inert caption is an explicit **zero→at-most-one initial OS-input setup contract change**, not a claim that passive/cold UI history remains unchanged. It does not establish the historical LOCAL/ARCHIVE physical cause or a product defect. It never substitutes for human confirmation, actual foreground, PTY/process close or business assertions.

Minimal structure: keep Windows-only setup in the existing LOCAL/ARCHIVE initial-activation generator and terminal generator/control. Prefer bounded C++ setup text in these existing build-only generators, with their existing exact full source/inverse; a fixed shared literal/function in an existing generator is sufficient. No generic broker, module/flag/download, launcher environment widening, keyboard rewrite or product/Mac branch change. If terminal setup is inserted by its existing generator into its C++ controller projection, raw terminal key/controller lineage can remain intact; tests must consume the actual full generated result, not only a stale raw gate prefix.

Required guards/order:

1. Original document/window/owner/epoch/WebView/controller qualification remains. Capture expected HWND/PID and require current process ownership; visible, enabled as applicable and nonminimized. Qualify again before form installation after selection; a stale epoch/document/controller/window cannot reuse a successful insert.
2. Set `attempted/inProgress` before the first setup native call; `complete` begins false and becomes true **only after SendInput reports3 inserted inputs**. A nested WM_ACTIVATE during insertion sees attempted && !complete and cannot launch the form. Short0/1/2 or precondition refusal must terminally refuse this setup using the fixture's existing failure path; later foreground/focus events cannot reset/retry or mark ready. Successful insertion still does not imply foreground.
3. Select one physical point in the non-client top band of the actual owned window. Caption center alone is insufficient: require actual WM_NCHITTEST==HTCAPTION, excluding icon, close/minimize/maximize buttons, border and client content. WindowFromPoint→GA_ROOT must equal captured root, with own PID; otherwise0input. Occlusion refuses, without raising/moving another window.
4. **One explicit physical-coordinate domain is required.** Current C++ host/build has no explicit DPI-awareness contract. Do not normalize an unchecked DPI-virtualized GetWindowRect against physical SendInput coordinates. A small scoped thread-DPI context around coordinate collection/hit tests/mapping, restored on every exit, is a suitable implementation choice; refuse if that domain cannot be established. This changes no process-global DPI/product setting. A rectangle/client-screen top-band midpoint can supply the single candidate; HTCAPTION remains the authority. Admit signed16 screen x/y before WM_NCHITTEST LPARAM packing; never truncate. Validate actual virtual-desktop origin/extent, including negative origins, and use wide intermediate arithmetic.
5. Use real Windows SDK `INPUT[3]` and `sizeof(INPUT)`, MOVE|ABSOLUTE|VIRTUALDESK then LEFTDOWN/LEFTUP in one SendInput call. No PostMessage keyboard changes, extra click, retry, timer, foreground bypass or polling. Check returns3; retain the original actual foreground join and all20/45/confirmation/PTY/close assertions. Window hit test and SendInput are separate OS operations, not an atomic HWND-targeted promise; existing lease does not own the whole OS desktop.
6. **Node hosted gate:** LOCAL/ARCHIVE currently lack the remote guard; apply existing pure `hostedTerminalHost705()` conditionally for Windows before their actual native launch. Do not blindly call `hostedTerminalAdmission705()`: it also prunes Node environment variables and requires data-directory ancestry, while these two cases assign sibling os.tmpdir case directories. Reusing that larger routine would add an unrelated mutation/refusal. The pure host checker already verifies GHA=true and RUNNER_OS=Windows. TERMINAL retains its existing admission. Native launcher stays OS-env-only (launcher.c107–136), with no GHA/RUNNER/provider keys added. Mac behavior remains unchanged.

## B. FIRST DIALOG — only three existing-server statistics

No confirmed first-dialog source race was found in the prior actual-source3FIFO controls. This proposal only discriminates an unobserved boundary; it does not share the pre-form mouse diagnosis.

Small closed projection:
- `terminalAttempted`: boolean, set before an existing terminal ws.send attempt.
- `openReplyAttempts`: bounded counter0..6 (6means6+), increment on existing desktop.thread.open.result send attempts.
- `sendRequests`: bounded counter0..4 (4means4+), count authenticated incoming desktop.chat.send requests in the existing onmessage callback.

These are attempts/requests, never delivery/admission/UI completion claims. Update only existing ws.send/onmessage callbacks and the existing final D476_DIALOG_NATIVE_PHASE JSON. No extra send, promise, handler, request order, key, timeout or native stage. The original third-user ACK drop and owner retirement remain exact. Unknown/zero is not attributed to SDK or input without the newly relevant boundary.

Observation insertions can use four explicit OBS826 blocks (counter declaration, send counters, incoming counter, final three JSON fields); current native block count5→9. Current source hash changes, **prior46d852529cfbb6016484b8680d534549303d9c88e0083ffa83d9071b18886e16 stays locked**. Actual full inverse must pass LF/CRLF and reject outside drift.

The separate Windows hosted-admission calls are behavioral, so do **not** hide them in OBS826 or claim pure observation equivalence. Use the existing source-lineage machinery's smallest explicit, current-hash-bound two-call inverse before the observation inverse, keeping its intermediate observation-only hash and prior bytes fixed. This is source-review accounting, not a new runtime compatibility layer. Similarly the generated initial-input behavior must be declared explicitly even though its full product-source inverse still equals original host bytes.

## Actual finite controls

`/tmp/cmspark-826-initial-owned-input-design-controls.cjs` and `.log`, Node22.23.4 via nvm: **10PASS**. No shared source edit or actual Windows API.

- Actual complete current LOCAL/ARCHIVE/TERMINAL generators produce source whose full inverse equals current real DesktopHost.cpp. Actual begin bodies, with OS leaves inert, show foreign foreground starts0 forms. An in-memory design insertion performs exactly one admitted setup, still starts0 while foreground is foreign, and starts exactly1 after owned foreground callback. No extra input on subsequent callbacks.
- Design-caption contract refuses occlusion/foreign PID/noncaption/minimized/bad geometry/unknown physical domain/signed16 overflow with0input. Negative virtual origin maps admitted point correctly. These are source/design models, not physical hit-test or native SDK ABI proof.
- SendInput short0/1/2 plus nested activation and later qualified callbacks never start a form or retry. Full3 cannot start during the insertion callback but can after actual return. Stale epoch before/during selection refuses form startup.
- Actual pure hostedHost705 function rejects missing GHA/wrong runner, accepts proper Windows GHA, and leaves environment unchanged. No native env expansion.
- In-memory insertion into the actual whole first-dialog TS file adds exactly4 observation blocks; the real existing OBS826 restorer, with only its new current hash/count adapted privately, restores complete historical prior bytes in LF/CRLF. Outside drift rejects; old prior hash unmodified. This prototype intentionally does not disguise the future hosted behavior calls as observation.
- Actual server callback bodies from that projection execute bounded3stats while retaining forwarding, original third-user ACK drop and no private output. No new handler/transport call is added.

Command: `node /tmp/cmspark-826-initial-owned-input-design-controls.cjs`.

## Source-gate acceptance boundary

Implementation must prove actual emitted SDK calls/coordinate setup/restore, one-attempt and full3 fence, current qualification before/after, hosted-before-launch, original full generated inverse and all affected actual source consumers. Windows compile/native execution is still required later; CPU contract models are not Win32 correctness or a claim the single click will win foreground. Refusal/short/lost foreground remains failure under the original budgets. B nonauthor source + actual GLM design/source gates remain separate; this review neither edits nor dispatches anything.
