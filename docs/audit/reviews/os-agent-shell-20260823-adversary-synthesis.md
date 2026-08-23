# OS Agent Shell — 六路独立对抗合成（2026-08-23）

| Field | Value |
|-------|--------|
| Input | `feat/os-agent-shell` HEAD `659bbce` + dirty tree（grok-bot 未提交切片） |
| Base | `origin/main` merge-base `fc187257` |
| Blast | **T3** |
| Lanes | ARCHITECTURE · SECURITY · CORRECTNESS · PRODUCT-UX · UI-DESIGN · CODE-QUALITY · DETECTOR-B |
| 六路实现 VERDICT | 全部 **REJECT**（Detector 对 HTML 规格稿 **APPROVE_WITH_NITS**，不审 Swift 实现） |
| 本文件角色 | 交叉共识 + 机核 + 编排者核验。不替代各路原文。 |
| Pi 复审 | **未跑**。已 REJECT，不构成 merge 候选，Pi 不是放行门。 |

原文：

- Architecture: `docs/audit/reviews/os-agent-shell-20260823-architecture.md`
- Security: `docs/audit/reviews/os-agent-shell-20260823-security.md`
- Correctness: `docs/audit/reviews/os-agent-shell-20260823-correctness.md`
- Product-UX: `docs/audit/reviews/os-agent-shell-20260823-product-ux.md`
- UI-design A: `docs/audit/reviews/os-agent-shell-20260823-ui-design.md`
- Code-quality: `docs/audit/reviews/os-agent-shell-20260823-code-quality.md`
- Detector B: `docs/audit/reviews/os-agent-shell-20260823-detector.md`

---

## Eval gate card

**Blast tier**: T3  
**Capability (ADR-020)**: Surface L0 capture overlay（macOS）；L2-classes 无新增；Compose 索引漂移；Trust 单 SHA 门 + overlay 非确认 writer；Channel community

### Machine [executed · orchestrator 2026-08-23]

| Command | Result |
|---------|--------|
| `companion` `tsc -p tsconfig.test.json` | **0** |
| 指定 `node --test tests/*.ts`（未走 runner） | 0/14 ESM 失败 — 不是本仓跑法 |
| compiled `.test-dist` summoner 相关 16 文件 | **150 pass / 2 fail** |
| `chrome-extension` overlay-standby | **18/18** |
| `shasum dist/cmspark-tray` vs working-tree `SWIFT_TRAY_SHA256` | **match** `6d7de4ed…` |
| HEAD pin `267e24b2…` vs working tree | **stale on HEAD**；pin 改在 uncommitted `swift-tray-bridge.ts` |

失败的 2 个测试是 **Swift 源码 grep 剧场**，不是用户旅程：

- `makePlainLine` 已不存在
- `appendToken` 仍调用 `refreshLog()`，测试禁止该符号

### Trajectory

- Diff vs main ≈ +10082 / −122（约 39% 文档、23% 测试、14% `Tray.swift`）
- 未提交 grok-bot：气泡→纯文本、藏 MCP/设置按钮、热键占用标签、lease CAS 重试；**同时留下死 chrome、markdown 解析、坏掉的 grep 测试**
- 8+5 用户证伪 **未跑**（ship note 自己写 NO-GO）

### Judges

| Lane | VERDICT | Status |
|------|---------|--------|
| Architecture | REJECT | BLOCK |
| Security | REJECT | T3 fail-closed |
| Correctness | REJECT | P0 journeys false |
| Product-UX | REJECT | identity lie |
| UI-design A | REJECT | 20/40 |
| Code-quality | REJECT | AI-slop shape |
| Detector B | APPROVE_WITH_NITS | HTML spec only |

**MERGE: NO** — MACHINE 非全绿 + 六路 REJECT。实现会话不得自评放行。

---

## 1. 交叉共识（独立出现 ≥3 路 → 视为真）

编排者对下列条目做了二次 `[inspected]` 路径核验。

| ID | 共识 | 路 | 核验 |
|----|------|----|------|
| **X1** | **`composer.lease` 不是可见性 SoT**。打开不 claim，关闭不 release，变更不广播。Overlay 发过一次之后，Side Panel 可永久 `OVERLAY_STANDBY` 直到 Companion 重启。 | A, C, P, Q | `menu-bar-agent.ts:976-978` `summoner.closed` 空 return；claim 只在 submit `client.ts` / `menu-bar-agent.ts:690-697`；`handleComposerLeaseFamily` 只回请求 socket |
| **X2** | **Approach A 滑向 Approach B**。S7/S8 薄捕获壳被 STT、settings、MCP、`新对话`、markdown、40 行 hydrate 撑成第二聊天窗。 | A, P, U, Q | `Tray.swift` settingsBox/mic/新对话；`attributedLine` 仍 `AttributedString(markdown:)`；`HYDRATE_CAP=40` |
| **X3** | **`#` 检索是假的**。Swift 滤 tray 缓存 5 条 `alias\|\|id`；Node `handleSummonerSearch` 跑完 `thread.list` **丢掉结果**；选中不 hydrate。 | C, P, Q | `handleSummonerSearch` `menu-bar-agent.ts:730-737` + inbound `void` `945-947`；Swift `refreshHits` `recentThreads.filter`；`selectThread` 不清 hydrate |
| **X4** | **身份锁「同一 thread」是假的**。默认 idle 10min + `last_activity_at==null` → 第一次打开就 `thread.create`。用户对着空白新会话说话。 | P, C, A | `shouldStartNewSummonerThread` `client.ts:165-175`；`handleSummonerReady` `653-668` |
| **X5** | **测试是源码剧场**。大量 `readFileSync` + `assert.match`。未提交改 Swift 后 2 测已红。测试还把 40 行 cap、lease steal、self-ui continue 锁成「正确」。 | C, Q, A, S | `[executed]` overlay grep 2 fail |
| **X6** | **`L2_CONDUCTOR_ELSEWHERE` 是文档幽灵**。P0 最小集第三条不存在于 TS/Swift。LIVE CU 时 overlay 仍可 `chat.create`。 | A, C | `rg` 仅 brief + plan |
| **X7** | **S21 ACL 绑客户端自报 `surface`**。省略 → 全权 tray。stdin `saveConfig` 绕过被拒的 `config.set`。 | A, S | `lifecycle.ts:990-991`；`summoner-acl.ts:34`；`menu-bar-agent.ts` settings persist |
| **X8** | **S23 没做窗坐标硬拒**。Task 12 把 `cmspark-tray` 标成 self-UI 后 `forceForeground` **continue**（新的 CU grant-skip）。测试把 continue 标成 S23。 | S（主），A 附和 | `self-ui.ts:40-67`；comment 自己写 window-rect is P1 |
| **X9** | **视觉不是选定稿**。看山 token 被抄了，构图没有。Indigo 到处用。首开是热键墙。未连接双 CTA。 | U, P, Detector | UI 20/40；chosen.html 自己也有 ⌕ + foot `[hidden]` 被 CSS 打穿 |
| **X10** | **adapter `chat.error` 丢掉 `error_code`**。Overlay CTA 靠 `BROWSER_UNAVAILABLE` 点亮「已连接，继续对话」——这条帧没有 code。 | C（主） | `adapter.ts:1452-1458` 只发 `error_level`；Swift `applyError` 认 `errorCode == "BROWSER_UNAVAILABLE"` |

---

## 2. 真正 lock 住的（不要为了骂而抹掉）

独立多路承认：

1. **S1** Companion 仍是唯一 tool-loop。Overlay 没有第二套 LLM。
2. **S19** L1 不打回 tray/summoner socket。缺 peer → `BROWSER_UNAVAILABLE` helper，且 `classifyError` 有显式 non-retryable 分支。
3. **S6** Overlay 不渲染 Allow/Deny，无 `summoner.confirm.*`。
4. **S11** 占用热键（⌘Space / ⌥Space / ⌃⇧Space）不可选。
5. **S13** 拉起 Chrome 是 UI RPC，不是 tool schema。CTA 文案含「我们不能替你打开侧栏」。
6. **关窗 ≠ `chat.abort`**（S9 半边）。IME `hasMarkedText` 挡回车。
7. 空场「先说话、`#` 才搜」的 **IA 方向**是对的——实现把检索和线程接错了。

这些是 spike 里可保留的内核。产品失败不在「完全没做边界」，而在 **边界旁边长出了第二个产品，还用测试把漂移锁死**。

---

## 3. 从用户角度看会发生什么

一条真实路径（PRODUCT + CORRECTNESS + 编排者核验）：

1. 菜单「召唤器（实验）…」→ 先是 **310pt 热键问卷**，不是选定稿空场。
2. `summoner.ready` 因 idle 默认新建线程 → **不是侧栏那条对话**。
3. 用户打字回车 → 对空白新 thread 说话。L0 能发。以为在续聊。
4. 输入 `#投研` → 只在托盘最近 **5 条 alias/id** 里滤。点中 **不 hydrate**。Node 全量搜索结果被扔掉。
5. 模型要网页 → L1 走对了执行器；但 overlay 可能拿不到 typed `error_code`，继续按钮不亮，日志打出 `系统: BROWSER_UNAVAILABLE`。
6. 用户关掉 overlay。Swift 注释写「Close releases」。Node **不 release**。侧栏下一次发送才发现「这边暂时打不了字，正在召唤器里说」——召唤器已经关了。
7. 按住 🎙：Whisper 没下好时，提示去 **Side Panel 设置下载**。Chrome 已退出则死路。Brief 原本禁止 overlay 听写。

这不是「细节毛糙」。这是 **身份 2（关 Chrome 续同一 thread）在用户可观察层失败**。

---

## 4. UI/UX（Impeccable dual-agent）

**Method:** A `01a02e22-fcd6-7241-a00c-9543e6c51062` · B `01a02e22-fcd6-7241-a00c-956d051b38e9`  
**Health:** **20/40**（Acceptable 地板）。没有任何一项启发式得 4。

设计特异性：**品类可替换**。更像 Raycast 输入框粘在剩下来的 ChatGPT 浮窗上，而不是 看山捕获卡。

Detector 对 **HTML 规格稿** 也已经在撒谎：talk 场放了 ⌕；`.foot { display:flex }` 盖过 `[hidden]`，空场/检索/未连接都会画出「发送 + 已连接，继续对话」。Wireframe PNG 空场仍写「输入线程标题」（v2 之前的搜先）。**规格和实现都没有守住选定锁。**

---

## 5. 必须修才有 APPROVE* 资格（按爆炸半径）

### BLOCK（不合、不自称 P0 done）

1. Lease 跟随可见性：open/hydrate claim，close release，广播到 Panel，禁止 steal retry。测试必须在关窗后 Panel 可写。
2. 同一 thread：第一次打开 hydrate **最近活动线程**，禁止默认 `thread.create`。Idle 政策若要留，不得静默开新会话。
3. `#` 检索：Swift 必须消费 `thread.list` 命中（标题+时间），选中必须 hydrate。禁止 5 条 alias 缓存当搜索。
4. S23：窗坐标硬拒 CU 点击 overlay/HUD/tray/配对；撤销 `cmspark-tray` process-level continue。或正式 AMEND S23 并改测试名——现在是规格洗白。
5. `chat.error` 带上 `error_code`，Swift CTA 才能亮。
6. 删掉或正式 AMEND：overlay 设置、`saveConfig` 旁路、MCP 徽章、markdown 家、hydrate 40、`L2_CONDUCTOR_ELSEWHERE` 空头支票。

### 产品形态（否则永远是第二聊天窗）

7. Distill 到选定四态：空场 = badge + 输入 + 一句 hint。检索 = `#` + 带时间的标题行。续聊 = 纯文本行 + 发送。未连接 = **一块**诚实 CTA。热键选择挪到首次成功发送之后或托盘设置。
8. 停用源码 grep 当 UI 测试。旅程测协议与状态机；Swift UI 走手工 M1–M8（journeys spec 已写，未执行）。

---

## 6. 对「grok bot 质量差」的裁定

**成立。** 不是「不会写 TypeScript」，是 **把 brief 当注释、把测试当海报、把 overlay 当产品膨胀**。

可保留：`composer-lease.ts` 数据结构、`summoner-acl.ts` 形状、`l1-actuator.ts`、`hydrate.ts` 纯函数（cap 改回 20）。

应重写：`SummonerController` 从 `Tray.swift` 拆出；stdin 协议冻回 P0 白名单；Swift 与 TS 共用一种命中/hydrate 合约，禁止双实现再 grep 对齐。

未提交切片方向对（去气泡、检测中 badge、占用键标签），执行仍是 slop（死字段保 grep、markdown 还在、测试红）。

---

**合成 VERDICT: REJECT**

身份 2 的用户可观察 DoD **未满足**。T3 安全面 S23 反向实现。不得合 main，不得对外称 P0 证伪通过。
