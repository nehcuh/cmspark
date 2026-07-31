# #au4dch UX Wave 1–2 总结报告

> **日期**: 2026-08-01  
> **分支 / worktree**: `feat/au4dch-ux-wave123` @ `C:\Users\HuChen\Projects\cmspark-wt-au4dch`  
> **基线**: `origin/main` @ `fca416d`（含 UX 子轨文档）  
> **主计划**: [optimization-plan-au4dch-ux-shell-download.md](../../optimization-plan-au4dch-ux-shell-download.md)  
> **产品规划**: [2026-08-01-au4dch-product-plans.md](../../superpowers/specs/2026-08-01-au4dch-product-plans.md)

---

## 1. 任务完成定义（对照用户三点）

| # | 用户痛点 | 交付判定 | 状态 |
|---|----------|----------|------|
| 1 | 插件下载重复 | `downloads_find` + `prefer_existing`（仅 Downloads 根） | **完成** |
| 2 | 主线程像已结束 | processingLabel 扫 running tools + 不因 streaming 隐藏；fleet 轻量指示 | **完成** |
| 3 | 黑窗 / 看不见输出 | `windowsHide` + `tool.progress` 秒数与 tail（origin unicast） | **完成（one-shot 止血）** |
| — | 网页端交互 PTY | 规格保留，**本迭代明确不交付** | **deferred epic** |

---

## 2. 优先级与流程（已执行）

1. 调研 + 产品规划文档（worktree）  
2. Worktree 实现 Wave1（ST+SH-A）+ Wave2（DL）  
3. 内部对抗 → **FAIL**（B1 path 过宽、B2 progress broadcast、M1 streaming 门）  
4. 修复 → 对抗复验 → **PASS**  
5. 外部评审：  
   - **内部对抗复验 B1/B2/M1 → PASS**（权威门）  
   - **Pi**：CLI 两次仅输出 tool_call 骨架、无终态 VERDICT（机读失败 / 已知 hang 类问题）→ **waive**，记录于 `au4dch-ux-wave123-pi-*.md` 残片  
   - **Claude Code**：本机 `Not logged in · Please run /login` → **waive**  
6. 单测：companion schema/path-sandbox/shell；extension downloads-find（全绿）  
7. **已 push 分支** `origin/feat/au4dch-ux-wave123`；**未 merge main**

---

## 3. 实现清单

### 3.1 下载去重（DL）

- `chrome-extension/src/background/downloads-find.ts` — find + Downloads 路径过滤 + URL 去 query  
- `browser-download-handler.ts` — `prefer_existing` / `force_redownload`  
- companion schema / tool inject / path-sandbox 允许 hint-only prefer  
- 测试：`chrome-extension/tests/downloads-find.test.ts`；schema + path-sandbox

### 3.2 运行态（ST）

- `ChatView.tsx` — 扫 `status===running`；running 时忽略 streaming 隐藏；舰队 N worker  
- `useWebSocket.ts` — `tool.progress`  
- ToolCallCard — 秒数 + stdout/stderr tail

### 3.3 Shell 止血（SH-A）

- `capability/shell.ts` — `windowsHide: true`、`onProgress`、`tailChars`  
- `server.ts` — `sendOrigin` unicast `tool.progress`（**禁止** broadcast 尾巴）  
- `mission-pack-usage.md` — 用户说明

---

## 4. 对抗验证记录

| 轮次 | 结果 | 关键阻塞 |
|------|------|----------|
| 初审 security | **FAIL** | B1 任意 download 路径；B2 progress 全局广播 |
| 初审 UX | **FAIL** | M1 streamingContent 压掉执行中文案 |
| 复审 B1/B2/M1 | **PASS** | 见 subagent re-verify |

### 修复摘要

| ID | 修复 |
|----|------|
| B1 | `isPathUnderDownloads` + Desktop 单测；`redactDownloadUrl` |
| B2 | `execOpts.sendOrigin`；shell progress 仅 origin `ws.send` |
| M1 | running tools 优先于 streamingContent；status bubble 始终可显示 |

---

## 5. 测试证据 `[executed]`

- companion: `browser-download-schema` + `path-sandbox` + `shell-progress-windowsHide` → pass  
- extension: `downloads-find.test.ts` → 10 pass  
- extension `tsc --noEmit` → clean  

未跑：完整 companion 全量 CI、Windows 真机 10s+ shell 目视（spawn 选项单测覆盖 windowsHide）。

---

## 6. 能力声明（ADR-020）

| 轴 | 说明 |
|----|------|
| Surface | L1 下载只读 find；L2 shell 仍 forceConfirm + token |
| Composition | 无新一级常驻入口；Pack 无关 |
| Autonomy | 仅 label 显示 fleet count；无 auto-spawn |
| Trust | progress 不落审计命令正文；不放宽 L2；cache 路径收紧到 Downloads |

---

## 7. 明确未做 / 后续

| 项 | 说明 |
|----|------|
| SH-B PTY + Cockpit xterm | 独立 epic + dual-review |
| ST-4 FocusBand 活跃条 | 可选 polish |
| DL-3 skill 强制 find | tool 描述已引导 |
| shell_exec 默认 60s 超时拉长 | 未改（避免悄悄扩大 blast） |
| merge 到 main | **需人工 PR 合并** |

---

## 8. 如何验收（人工）

1. 重载 extension + 重启 companion（worktree 构建产物）  
2. Downloads 已有 `foo.tar.gz` → Agent `downloads_find` / `browser_download`+hint → `source:cache`  
3. 批准长 `shell_exec`（>5s）→ 无空黑窗；侧栏「执行中」+ 秒数 + tail  
4. 多客户端：progress 不应打到非 origin 的第二 peer（B2）

---

## 9. 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-01 | Wave1–2 实现 + 对抗修复 + 本总结；分支 `5423888` 已 push；Pi/Claude 外部评审 infra waive，对抗 PASS 作门 |
