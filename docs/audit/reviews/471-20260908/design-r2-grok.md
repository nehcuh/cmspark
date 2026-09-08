I'll read the packet first and follow its review instructions exactly.The packet is a blinded r2 design re-review. I’ll ground first-round concerns in the live issue and current settings/summoner IA, and skip other reviewers’ notes.I'll skip the other reviewers' files and inspect issue #471 plus the current settings/summoner IA so the re-review can close or retain those first-round concerns.Independent design re-review of #471 r2. Implementation was used only as a control inventory; this is not an implementation sign-off.

**VERDICT: REVISE** — do not treat this packet as merge-gated. Close four of five first-round axes in substance; keep four written holes that still let an implementer ship the old bugs.

---

### Trust strip — RETAIN (live + modal), CLOSE placement/focus

**Close:** placement, copy, `isElevatedTrust`, no new permission logic, same DOM at 320/1440, wrap, empty = no chrome, heading focus on click, status updates do not steal focus, in-progress phrase stays on `security`.

**Retain — live region:** `role=status` / `aria-live=polite` on a **container that includes the buttons** is still wrong. Live regions must not own interactive controls; pairing and elevated can both show, so the status name becomes two buttons and will re-announce on every pairing tick. Split: polite text node only; native buttons **adjacent, outside** the live region.

**Retain — modal inventory:** “真正的模态许可确认” is unnamed. Phrase/whitelist/arm UI is inline, not `Modal`. The real nested dialog is the experimental **license door** (`Modal` inside the settings `Modal`). “Lift outside the content pages” still nests two `aria-modal` traps. Name every overlay, and specify Escape / focus restore / parent-dialog inert so the license door cannot die under `hidden` or fight the settings trap.

Pending arm (flag still false) has **no** public security entry; the strip only appears after `isElevatedTrust`. Say whether mid-phrase is cancelled on category change or only recoverable via nav.

---

### Save-scope — CLOSE table, RETAIN chrome lie

**Close:** “一处” = public footer, not deletion of UserEnv / MCP / NetSec / download / enable / phrase buttons; `handleSave` / `handleTest` once; test uses current model/vision draft regardless of page; drafts stay mounted; hydration gate unchanged; no fake “cancel all”.

**Retain:** the always-visible label **「保存全部配置」** still claims UserEnv / MCP / voice drafts / phrases. Page blurbs do not override chrome. Either rename to config-only (e.g. 「保存模型与文件配置」) or dirty-scope the button. Also say whether original `handleSave` **closes the dialog** — in a multi-page IA that wipes place and is unspecified.

Security whitelist vs immediate arm, and experimental flags vs license/download, still need one line each: which fields the footer actually writes.

---

### IA / stable IDs / migration / voice setters — CLOSE, one leftover

**Close:** eight ids and the move table; `voice` added; `export` display name; pages stay mounted + `hidden`; unpaired → `connection` only if the user has not chosen; deep link / manual choice wins over late pairing; `useComposerVoice` and voice NL intents → `voice`; `open_meeting` / `open_scene` leave; accordion LS unused.

**Leftover (fix in this packet, not a new axis):** companion `settings_path` still says **「本机与集成」** while the page is **「本机与工具」**; session index left `experimental` with no old-path note. Integrations “加清楚子标题” is not a title list.

---

### Nav a11y — RETAIN dual control

Native buttons + `aria-current=page` + focus `h3[tabindex=-1]` + `hidden` pages out of Tab + no CSS `order` are enough for one widget.

**Retain:** both the 172px `nav` and the labeled `select` are specified without saying the **unused** one is `hidden`/`display:none` and out of the a11y tree. At 320 that is a second “设置分类” and extra tab stops; at 1440 the select can remain reachable. One visible, one not in Tab, at each breakpoint.

Narrow: keep focus on the `select` is fine. Do not also focus `h3`.

---

### Visual contract — CLOSE summoner, RETAIN settings chrome

**Close summoner:** token hexes match the chat tokens; 14/1.7; composer radius 20; textarea then attach → dictation → send in real DOM; outline secondaries; empty `CHAT_SHELL_TITLE_NONE` + specified subtitle; 山 limited to header / initial empty / `renderMsgs` empty and all three removed. settings-web stays a model-only spare page.

**Retain settings:** no selected / hover / focus-visible recipe for the 172px rail (fill, weight, `tokens.navSelected`, ring). `h3` takes programmatic focus — visible focus required. 320 “no horizontal overflow” is unenforceable until the rail is specified as not laid out at `<760`.

---

### Closed vs retained

| First-round axis | Call |
|---|---|
| Trust strip placement / copy / focus | **CLOSE** |
| Trust strip live + modal reachability | **RETAIN** |
| Save-scope composition (table) | **CLOSE** |
| Save chrome label + close-on-save | **RETAIN** |
| IA / ids / voice setters | **CLOSE** |
| `settings_path` / session-index copy | leftover under IA |
| Nav a11y (dual widget) | **RETAIN** |
| Summoner visual + 山 inventory | **CLOSE** |
| Settings nav visual states | **RETAIN** |

No implementation approval. After the four retains are written (live/buttons split, named nested dialog, one nav widget per breakpoint, save label/close, rail selected+focus), this design can be re-gated.
