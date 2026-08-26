# Overlay post-#222 residual — Product / UX adversary

**Batch:** `overlay-post222-residual`  
**Lane:** PRODUCT-UX (independent; did not implement; did not read other `overlay-post222-residual-adversary-*` reports)  
**HEAD:** `a58b78fd444bcd5eb49698b1d802d4fc959d963a` (`a58b78f` Merge `fix/windows-tray-nodepath` into `main`)  
**Range:** `ac0a3be..HEAD` (#222 squash `6ce291d` + P1 fold `03de168` + Windows tray `c8d0984` + C-thin scroll `dfab3eb` + this merge)  
**Spec:** `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`  
**Focus:** I1 I2 I4 I5 I7 (user-visible). I3 I6 I8 scored only as out-of-lane (not CLOSED).

```text
Surface:      L0 overlay HUD workbench + C-thin HTML
L2-classes:   none on HUD; mcp.add / stdio enable uses tray L2
Compose:      threads / pack.apply / mcp.toggle / skill / knowledge USE+import
Autonomy:     n/a
Trust:        overlay ACL overlay-safe; mcp.add/knowledge.import off summoner WS
Channel:      community
```

**Blast:** T2 residual UX + T3 stdin import/add paths.

---

## 刻意边界（遵守，不挑战）

- 网页 CDP 仍要 Chrome 扩展。本通道**不**把「MCP 工具执行走 Side Panel」判成 BLOCK。
- Overlay **不做** Allow/Deny 方言。托盘 `showConfirmDialog` 是 L2。本通道要求的是诚实 pending / 失败文案，不是 HUD 里画确认钮。
- Win/Linux C-thin **不是** Mac HUD 视觉克隆。本通道不因配色/52pt 轨缺失而 REJECT。
- **不**要求 `knowledge.import` 上 overlay WS。

---

## Machine `[executed]` / `[inspected]`

| Check | Result |
|-------|--------|
| `git rev-parse HEAD` | `a58b78fd444bcd5eb49698b1d802d4fc959d963a` |
| `03de168` ancestor of `dfab3eb`? | **no** (`git merge-base --is-ancestor` exit 1). `dfab3eb` parent chain is `c8d0984 → 6ce291d`, skipping the P1 fold. |
| Merge parents of `a58b78f` | `03de168` + `dfab3eb` |
| `git diff 03de168 HEAD -- companion/src/summoner-web.ts` | **−226 / +88** — C-thin HUD HTML 被换回 #222 暗色壳 |
| `npx tsx --test tests/summoner-web.test.ts tests/summoner-shell-open.test.ts` | **35 tests, 3 fail** `[executed]` |

Failing contracts (all authored in `03de168`, still on HEAD tests, **not** on HEAD HTML):

1. `C-thin HTML skills toggle and knowledge attach are not activate-only / replace-all` — expected `skill_name:s.name,on:!on` / `ids:next`; HEAD still `on:true` / `ids:[id]`.
2. `GET / with token → 200 HTML workbench` — expected `--paper:#fff` / `.rail-btn`; HEAD is `#12141c` dark stack.
3. `planSummonerShellOpen uses --app window when browser path is known` — expected `--window-size=720,120` (收起条); HEAD is `800,720` always-expanded.

`HTML mcp.toggle rides tray companionClient` **passes** (source lock only — does not prove a human can complete L2 on Win/Linux).

---

## Scorecard (must: CLOSED / OPEN / WONTFIX)

| ID | 问题 | HEAD 判定 | 严重度 | 证据 |
|----|------|-----------|--------|------|
| **I1** | C-thin 技能 tab `on:true` 只激活不关闭 | **OPEN** | MAJOR | `[executed]` 测试红；`summoner-web.ts:924` |
| **I2** | C-thin 知识 tab `ids:[id]` 整表替换、不能卸 | **OPEN** | MAJOR | `[executed]` 测试红；`summoner-web.ts:939` |
| I3 | Swift 非 UTF-8 当正文 | **NOT IN LANE** | — | 未核；不标 CLOSED |
| **I4** | C-thin 开已禁用 **stdio** MCP → 无法答 L2，~45s | **OPEN** | MAJOR | `[inspected]` 托盘 L2 + systray2 never-promise；点击无 pending |
| **I5** | Mac `prefix(12)` / `slice(0,8)`，无独立滚动 | **OPEN** | MAJOR | `[inspected]` Swift 列表不在 `NSScrollView` |
| I6 | `knowledge.set_active` 未知 id 静默丢 | **NOT IN LANE** | — | 未核；不标 CLOSED |
| **I7** | `dfab3eb` 声称 C-thin 可滚、头/底栏不被挤 | **OPEN** | NIT→MAJOR via 回归 | CSS 像能滚；03de168 的独立 `list-scroll` + 收起条被 merge 吃掉 |
| I8 | F-I-5 / PEM END / F-S-1 | **NOT IN LANE** | — | 未核；不标 CLOSED |

**R5:** `03de168` **确实折过** I1/I2（`on:!on`、`ids:next`、已用/未用文案、`.list-scroll`）。`a58b78f` 用 `dfab3eb` 侧的 `summoner-web.ts` **整文件回滚**。把 I1/I2 标 CLOSED 会触发本批次 R5。本通道标 **OPEN**。

---

## 新引入回归（#222 之后的 fold / merge）

**P-REG-1 — `a58b78f` 把 Windows C-thin 工作台从「已折的纸面 HUD」打回「#222 暗色标签堆」。** `[executed]` diff + 测试。

`03de168` 用户可见交付（对比 `git show 03de168:companion/src/summoner-web.ts`）：

- 看山 token：`--paper #fff` / `--indigo #4F46E5`，52px 描边 SVG 轨，一类列表 216px，`.list-scroll{overflow-y:auto}`。
- 收起默认 `--window-size=720,120`；展开才出轨+列表+对话。符合 spec §0「同一扇窗向下变高」，且 **不是** 把 C-thin 做成 Mac 像素克隆。
- 技能：读 `active_skill_ids`，行内「已用于本对话 / 未用」，点击 `on:!on`。
- 知识：读 `active_knowledge_ids`，行内「已挂到本对话 / 点击挂上」，点击 `ids:next` 增删。

HEAD 用户可见：

- 暗色 `#12141c`，顶栏五枚文字 tab，`.item{padding:7px}`，主按钮「发送」。
- 无收起/展开；`--app` 一开就是 800×720。
- 技能/知识语义退回 I1/I2。
- 常驻文案「批准在侧栏」「听写/知识配置/批准去侧栏处理」（`summoner-web.ts:655,674,762-763`）。Spec §1 反模式含「去侧栏」；听写走侧栏可接受（刻意边界 CDP），**知识 USE 已在本窗**，「知识配置去侧栏」是过期谎言。

这不是「C-thin 不必长得像 Mac」。这是 **main 已验收的 P1 用户面被后到的 Windows 分支覆盖**，而测试仍锁着 P1 契约。

---

## I1 — C-thin 技能只开不关  **OPEN / MAJOR**

### Outcome
Win/Linux 用户在技能栏点一行，状态说「已切换技能」，实际永远 `skill.activate`。再点还是激活。没有「已用 / 未用」，关不掉。Mac HUD 同一动作是真开关。

### Trajectory
1. 点技能行 → POST `/api/skills/toggle` `{on:true}`（`summoner-web.ts:922-924`）。
2. HTTP 层 `body.on !== false` 才走 deactivate（`:476-483`）——UI 从不传 `false`。
3. `setStatus("已切换技能")` 不刷新列表、不读 `active_skill_ids`。
4. 对比 Mac：`SummonerOverlay.swift:684-688` 发 `on: !on`；`menu-bar-agent.ts:938-962` `skill.activate` / `skill.deactivate`。

`03de168` 已做成 Mac 同构（读 thread 活跃集 + `on:!on` + 刷新）。HEAD 回滚。测试 `summoner-web.test.ts:539-545` 仍断言折叠后的语义 → **红** `[executed]`。

### Component
| 层 | 位置 |
|----|------|
| 错的点击 | `companion/src/summoner-web.ts:916-927` |
| 其实能关 | 同文件 `:472-484` `skill.deactivate` |
| 对的参照 | `SummonerOverlay.swift:684-688`；`menu-bar-agent.ts:938-962` |
| 契约 | `companion/tests/summoner-web.test.ts:539-545` |

**不是 WONTFIX：** spec B3 写「开关/安装第二刀」是波次，不是「永远只能开」。一旦做成可点行并写「已切换」，用户会当开关用。跨端方言（Mac 能关、C-thin 不能）是产品缺陷。

---

## I2 — C-thin 知识整表替换、不能卸  **OPEN / MAJOR**

### Outcome
点一篇知识 = `knowledge.set_active({ids:[这一篇]})`。当前对话上**其它已挂文档被静默卸掉**。再点同一篇仍是 `ids:[id]`，卸不下来。文案永远「已挂到当前对话」。

这比 I1 更糟：不是少一个关，是 **USE 集合被单行覆盖**。用户挂了 A+B，再点 C，A/B 消失且无提示。

### Trajectory
1. `summoner-web.ts:937-939` `ids:[id]`。
2. 不读 `active_knowledge_ids`，不画「已挂」。
3. Mac 正确：`handleSummonerKnowledgeAttach`（`menu-bar-agent.ts:965-978`）`next = current.includes(id) ? filter : concat`；Swift 行 `attached ? "● title"`（`SummonerOverlay.swift:615-624`）。
4. `03de168` C-thin 已复制该代数（`ids:next` + 「已挂到本对话 / 点击挂上」）。HEAD 回滚。同一测试断言 `ids:next` 且 **禁止** `ids:[id]` → **红** `[executed]`。

### Component
| 层 | 位置 |
|----|------|
| 替换全部 | `summoner-web.ts:930-943` |
| Mac 增删 | `menu-bar-agent.ts:972-979` |
| 契约 | `tests/summoner-web.test.ts:539-545` |

**不**要求 C-thin 上 `knowledge.import`（刻意边界）。USE 开关已经在 overlay-safe `knowledge.set_active` 上，只是点法写错。

---

## I4 — C-thin 打开已禁用 stdio MCP  **OPEN / MAJOR**

### Outcome
Win/Linux 工作台 MCP 行看起来是开关（`●`/`○`）。点开一个 **stdio、当前关闭** 的服务器：页面无 pending、按钮不禁用、错误被丢弃；进程在 origin 绑定的确认上等到 **45s** 超时，列表刷新后仍是关。用户得到「点了没反应」。

不要求 overlay Allow/Deny。要求：**不要提供一个走不通的开关，或走的时候说实话。**

### Trajectory
1. 点击（`summoner-web.ts:909-910`）POST `/api/mcp/toggle`，`.then(function(){loadCompose("mcp")})` — **不读 `d.error`**。
2. `dispatchSummonerWeb`（`menu-bar-agent.ts:1628-1630`）刻意把 `mcp.toggle_server` 改走 **tray** `companionClient`（60s），注释：「HTML C-thin cannot answer overlay L2」。源码锁测试因此变绿。
3. Router（`message-router/handlers/mcp.ts:394-410`）：禁用→启用且 `transport==="stdio"` → `requireMcpStdioSpawnConfirm` → `session.requestConfirmation` 打到 **发请求的那条 WS**（tray）。
4. Tray 收到 `security.confirmation.request` → `showConfirmDialog`，`timeoutMs` 默认 **45000**（`menu-bar-agent.ts:1831-1843`；`security-confirmation.ts:6`）。
5. C-thin 的宿主是 Win/Linux → `systray2-bridge.ts:170-173`：`showConfirmDialog(): Promise<never> { return new Promise(() => {}) }`。**没有原生 L2 窗。** Confirm 只绑 origin WS，不会自动落到 Side Panel。
6. 45s 后 deny；HTTP 终于返回 error；UI 当成功一样 `loadCompose`。全程无「正在等托盘确认 / 超时未开」。
7. SSE `mcp.confirm.pending` → 「MCP 工具需在 Chrome 侧栏批准」（`summoner-web.ts:992-994`）。那是 **对话里跑 MCP 工具** 的文案（刻意边界：CDP 仍要 Chrome）。**不是** stdio spawn L2。用户若碰巧看见，会被指去错误的表面。

Mac HUD 同路径有 Swift `showConfirmDialog`，stdio 开启可完成。产品裂口在 **C-thin 是 Win/Linux 唯一工作台** 时把「开 MCP」做成死开关。

可接受的产品修（均不违反刻意边界）：关着的 stdio 行不可点 + 一句「到设置页启用」；或 pending「等托盘确认」+ 把 timeout/deny 写进 status。不要在 HTML 里做 Allow/Deny。

### Component
| 层 | 位置 |
|----|------|
| 无反馈点击 | `summoner-web.ts:902-914` |
| 改道 tray | `menu-bar-agent.ts:1628-1630, 1831-1843` |
| L2 门 | `message-router/handlers/mcp.ts:394-410` |
| Win/Linux 空确认 | `tray/systray2-bridge.ts:170-173` |
| 45s | `security-confirmation.ts:6` |

---

## I5 — Mac 列表截断、无独立滚动  **OPEN / MAJOR**

### Outcome
展开工作台后，「一类列表」不是可滚的 220pt 栏，而是 **硬截断 + 可能裁切**：

- 对话：launcher 先 `hitsFromTitleSearch(threads).slice(0, 8)`（`menu-bar-agent.ts:791`），Swift 再 `threadRows.prefix(12)`（`SummonerOverlay.swift:369`）。用户最多看见 **8** 条。第 9 条起从工作台消失。
- 场景 / MCP / 技能 / 知识：Swift `prefix(12)`（`:562, 577, 595, 615`）。MCP/知识还有「＋ 添加/导入」占一行。
- `#` 搜索命中：`refreshHits` `hits.prefix(6)`（`:1121`），同样无滚。

行高 `≥44`（spec 要求）。12×44 = 528pt > 工作台高 `summonerWorkbenchHeight = 428`（`:44`）。`threadListStack` 只是竖 `NSStackView`，**没有**包进 `NSScrollView`（`:1739-1751`）。主列 `logScroll` 可滚；列表列不可。超高内容要么画出 workbench（有压住底栏的风险），要么被窗裁掉。底栏「永远在」在列表侧没有结构保证。

`#` 搜标题仍能碰到未进前 8 的对话（搜索是另一条 stdin），所以不是「数据丢了」，是 **工作台列表撒谎：这就是全部对话**。

C-thin HEAD 的 `.rail{overflow:auto}` 反而能滚完全部线程——以「分类 tab 一起滚走」为代价。`03de168` 的 `.list-scroll` 才是 spec 结构（轨钉死、列表自滚）。Merge 把它从 C-thin 拿掉了；Mac 从未有过。

### Trajectory / Component
| 层 | 位置 |
|----|------|
| 对话 8 条 | `menu-bar-agent.ts:791` |
| Swift 12 条 | `SummonerOverlay.swift:369, 562, 577, 595, 615` |
| 搜索 6 条 | `SummonerOverlay.swift:1121` |
| 无列表滚动 | `SummonerOverlay.swift:1727-1751`（对比 `logScroll` `:1667-1694`） |
| 高度预算 | `SummonerOverlay.swift:44` (`428`) vs 行 `:551` (`≥44`) |

**WONTFIX 不成立：** 截断不是视觉克隆问题，是「列表、搜索、切换」最低能力（spec §2.1）交付不全。

---

## I7 — C-thin flexbox 是否真可滚  **OPEN**

### Outcome
`dfab3eb` 声称：html/body 约束、header/rail `flex-shrink:0`、main/log `min-height:0` + overflow，头/底不被挤。该补丁打在 **#222 暗色 DOM** 上（`dfab3eb` 不以 `03de168` 为祖先）。Merge 采用该暗色 DOM，**丢弃** `03de168` 已分开的 `.list-scroll` + 底栏 composer + 收起态。

`[inspected]` HEAD CSS（`summoner-web.ts:621-641`）：

- `html,body{height:100%;overflow:hidden}`；`header` / `.composer` `flex-shrink:0`；`.log{flex:1;overflow:auto;min-height:0}`。
- **像**能保住顶栏和输入条，对话区可滚。本通道 **没有** 在 800×720 `--app` 里实测长对话/长列表。
- `.rail{overflow:auto}` 是列表**和**「对话/场景/…」tab 的共同滚动容器。长列表把分类按钮滚出视口。Spec 要钉住的轨 + 独立列表滚，这里没有。
- 主按钮仍是蓝「发送」（`:679`），spec §1「不要把发送做成主按钮」。在刻意边界下当 NIT，不当 BLOCK。

`[executed]` 工作台 HTML 测试仍要 `--paper` / `rail-btn` / `placeWindow(false)` / `720,120` → 红。说明仓库自己的「C-thin 已是可收起工作台」叙事与 HEAD 不符。

**不能 CLOSED：** 未浏览器实测；即便暗色 flex 没挤底栏，声称「修好」覆盖的是被回滚的更好布局，Mac 列表仍不可滚（I5）。标 CLOSED 会踩 R5。

### Component
| 层 | 位置 |
|----|------|
| HEAD 暗色 flex | `summoner-web.ts:621-641, 652-686` |
| 被丢掉的独立滚 | `03de168:companion/src/summoner-web.ts` `.list-scroll` / `.hud.expanded` |
| 窗尺寸回滚 | `summoner/shell-open.ts:55` `800,720` vs 测试期望 `720,120` |

---

## 其它用户可见（非 BLOCK，记一笔）

- C-thin 无知识导入入口：允许（刻意边界）。应把 hint 从「知识配置去侧栏」改成「导入请用设置 / 侧栏」，不要暗示本窗知识 tab 是残的配置中心。
- 对话里 MCP 工具确认去 Side Panel：允许（刻意边界）。不要和 stdio **启用** L2 混写成同一句。
- Mac 技能/知识开关、原生 NSAlert 回收站、无 Allow/Deny 字样：符合 spec。本通道未在 HUD 搜到「允许/拒绝」。

---

## Findings（产品刻度）

### BLOCK
无单独安全 BLOCK（R1–R4 / R6 非本通道）。**产品 REJECT** 由下面 MAJOR + R5 回归构成。

### MAJOR
1. **I1 OPEN** — C-thin 技能只开不关；「已切换」撒谎；`03de168` 折过又被 merge 回滚；契约测试红。
2. **I2 OPEN** — C-thin 知识 `ids:[id]` 覆盖整表且不能卸；静默丢掉其它 USE；同样回滚 + 测试红。
3. **I4 OPEN** — C-thin 开禁用 stdio MCP 是 45s 死点击；systray2 无 L2；UI 吞 error。不是「应在 overlay 做 Allow/Deny」。
4. **I5 OPEN** — Mac 工作台列表 8/12 截断、无 `NSScrollView`；超 44pt 行会溢出 428pt 工作台。
5. **P-REG-1** — `a58b78f` 回滚 `03de168` C-thin 纸面工作台 / 收起条 / 诚实开关。Win/Linux 用户面从「已折」退到 #222。

### NIT
- I7 暗色 flex 可能已不挤 header/composer，但未实测；轨与列表未分离。
- C-thin 「发送」主按钮、7px 行、五枚文字 tab：不按 Mac 克隆打 BLOCK。
- 「批准在侧栏」套在 MCP **工具** 上可接受；套在 MCP **开关** 或知识 USE 上会教错表面。

---

## 怎样才从 REJECT 下来

最低用户面（不必做 Mac 像素克隆，不必 overlay L2，不必 overlay `knowledge.import`）：

1. **恢复** `03de168` C-thin 技能/知识语义（或等价）：`on:!on`、`ids:next`、行内已用/已挂。让 `summoner-web.test.ts` 那条变绿。
2. MCP 禁用 stdio：C-thin 要么不提供「开」要么 pending+失败可见；禁止再 `.then(loadCompose)` 吞掉 45s deny。
3. Mac 一类列表：去掉静默 8/12 上限 **或** 给列表列独立滚动，并保证底栏不被撑没。
4. Merge 策略：`summoner-web.ts` 再与 Windows 分支合时，不许用 #222 暗色壳盖住已折工作台；窗口尺寸测试与 `shell-open.ts` 对齐。

I7 浏览器实测长日志/长列表可作 follow-up，不单独挡。

---

## 三层结论

| 层 | 判断 |
|----|------|
| **outcome** | Win/Linux 工作台技能/知识/开 stdio MCP 三条组合路径对用户是假开关或死开关；Mac 列表装不下自己的最低能力。Spec 写 B0–B4 已落地，HEAD C-thin 不是那份落地。 |
| **trajectory** | `03de168` 折了 I1/I2 并给了可滚纸面壳；`dfab3eb` 从 #222 修 flex；`a58b78f` 取了后者的 HTML，测试还锁着前者。I4 只做了「改道 tray WS」源码锁，Win/Linux 仍无处点 L2。 |
| **component** | `summoner-web.ts:924,939,909-910,655,674`；`menu-bar-agent.ts:791,1628-1630`；`SummonerOverlay.swift:369,562,577,595,615,1727-1751`；`systray2-bridge.ts:170-173`；红测试 `summoner-web.test.ts:112-132,539-545`、`summoner-shell-open.test.ts:71`。 |

未改生产代码。未读其它 `overlay-post222-residual-adversary-*`。

VERDICT: REJECT
