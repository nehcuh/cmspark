# OS Agent Shell — User Journeys (P0 overlay)

> **Date:** 2026-08-23  
> **Branch:** `feat/os-agent-shell`  
> **Status:** protocol + source-lock tests landed; Swift UI tests not run in this environment  
> **UI lock:** 先说话 × 看山白底；**历史是纯文本行，不是聊天气泡**；「实验」只出现一次（窗口标题）  
> **Related:** [brief](../../decisions/os-agent-shell-brief-2026-08-22.md) · [ship note](../../decisions/os-agent-shell-p0-spike-ship-note-2026-08-22.md) · [plan](../plans/2026-08-22-os-agent-shell-p0-spike.md) · [chosen HTML](../../design/os-summoner-p0-chosen.html)

---

## 1. Philosophy (user, not chrome)

召唤器是 **L0 捕获面**：Chrome 可以完全退出，仍能对着当前线程说话。它不是主界面、不是确认台、不是第二套设置。完整格式、MCP 增删、Whisper 下载、Allow/Deny 都在 Side Panel。

| Always | Never |
|--------|--------|
| 空场先说话（回车发到当前/最新线程） | 空场先搜标题 |
| `#` 才搜 **标题/别名**；hint「只搜标题，不搜正文」 | 搜正文 / 文件 / 应用；用户可见 P0 |
| 历史 `你:` / `助手:` 纯文本行 | 聊天气泡、markdown 气泡、主界面 |
| overlay 持 `composer.lease` 时侧栏只读 | 双草稿 |
| 未连接仍可 L0 发送 | 未连接就藏发送 |
| CTA 写「不能替你打开侧栏」 | 假装 `openSidePanel` |
| 热键 opt-in；占用键展示但不可选 | 默认 ⌘Space / ⌥Space / ⌃⇧Space |
| STT 仅 `surface=summoner` + `privacy_ack_v2` | 托盘菜单听写；`voice.model.*` |
| 打开前 badge「检测浏览器…」 | 已配对却写死「未连接」 |

---

## 2. Journeys that protocol now covers

### J1 — First open（菜单「召唤器（实验）…」，尚无热键）

1. 窗口标题 `CMspark 召唤器（实验）`。  
2. 顶栏 badge **检测浏览器…** 直到 `summoner.hydrate`（或 `BROWSER_UNAVAILABLE`）落地。  
3. 热键选择条：占用三项是 **标签**（⌘Space Spotlight 等），不可点；下面才是候选。菜单项始终能打开，不必等热键。  
4. 单一圆角输入，placeholder `说点什么，或按住说话…`。hint `回车发送到当前线程，输入 # 搜标题`。顶栏只有检测/已连接/未连接 +「新对话」，没有第二套设置、没有「召唤器 · 实验」小标。  
5. 有最近线程时显示 `继续 · {title}`。

**Verify:** `summonerBrowserBadge` · `summonerHotkeyPickerRows` · Tray source-lock (`检测浏览器…`, occupied labels).

### J2 — Empty-state send（含浏览器未连接）

1. 不键入 `#`，直接打字回车。  
2. Companion：`thread.list` → 最新线程；没有则 `thread.create`。  
3. `claimOverlayLeaseCas`（get + claim，rev 冲突重试）。  
4. fire-and-forget `chat.create`。L1 工具若无 extension peer → `BROWSER_UNAVAILABLE`，**不**自动重试。  
5. 发送按钮在 talk 态始终可见（含 detached）。

**Verify:** `submitSummonerTalk` · `claimOverlayLeaseCas` · overlay `sendButton` not hidden when detached.

### J3 — `#` title search

1. 输入以 `#` 开头才进检索。  
2. 针是 `#` 后文本；命中标题/别名。  
3. 选中命中：清掉 `#…`，回到说话，聚焦输入。  
4. hint 换成 `只搜标题，不搜正文`。

**Verify:** `isSummonerSearchQuery` / `filterThreadsByTitle` · Swift `hasPrefix("#")`.

### J4 — Dual composer / lease race

1. Overlay 打开后 holder=`overlay`。  
2. Side Panel `chat.create` → `OVERLAY_STANDBY`，文案「这边暂时打不了字，正在召唤器里说」，textarea 只读。  
3. Overlay 关闭 → `composer.lease.release` → holder=`panel`；关窗 **不等于** `chat.abort`。  
4. 并发 claim：get 与 claim 之间 panel 抢租约 → `LEASE_REV_MISMATCH` → 用返回 rev 再 claim。

**Verify:** `chrome-extension/tests/overlay-standby.test.ts` · `claimOverlayLeaseCas` tests.

### J5 — STT from summoner only

1. 按住 🎙 = 手势 = `privacy_ack_v2`。  
2. `Origin: cmspark-tray://local` **且** `surface: summoner` 才允许 `voice.stt.*`。  
3. `surface: tray` 或 `voice.model.*` → deny。模型下载仍走侧栏。

**Verify:** `isVoiceSttOriginAllowed` · `assertSummonerAllowed`.

---

## 3. Manual checklist (Swift UI — not executed here)

Host: macOS + hashed `cmspark-tray`. Do **not** expect XCTest in CI.

| # | Check | Pass if |
|---|--------|---------|
| M1 | 菜单打开，Chrome 已配对 | 首帧不是「未连接」；hydrate 后才变已连接/未连接 |
| M2 | 无热键首次打开 | 占用键灰色文案，点了无 `hotkey.chosen`；候选可登记 |
| M3 | 空场说话 | 无气泡；行是 `你:` / `助手:`；detached 仍有「发送」 |
| M4 | `#投研` | 只出标题命中；选中后回到说话 |
| M5 | IME 组字回车 | 5/5 不提交（S10） |
| M6 | 侧栏同时打开 | 侧栏只读「这边暂时打不了字，正在召唤器里说」；关 overlay 后可打字 |
| M7 | 网页工具 + Chrome 退出 | `BROWSER_UNAVAILABLE` + CTA 含「不能替你打开侧栏」；继续 = 新用户句，无 L1 replay |
| M8 | 麦 | 仅 overlay；托盘菜单无听写；`voice.model` 仍在侧栏 |

If M5 fails → CN no-go (ship note). Do not rewrite GOAL.md.

---

## 4. Remaining gaps

- 8+5 用户证伪（brief §11）未跑。  
- IME × 非 input 进程仍 OPEN。  
- 窗口矩形 self-ui / Chrome 五态 / Windows overlay 非本切片。  
- Swift 二进制若重建必须锁步 `SWIFT_TRAY_SHA256`。
