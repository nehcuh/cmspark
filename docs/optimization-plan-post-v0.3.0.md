# CMspark 后续优化计划（v0.3.0 发布后）

> **日期**: 2026-07-11 · **基线**: [`audit-report-cmspark-2026-07-09.md`](../audit-report-cmspark-2026-07-09.md)（55 findings，总分 4.4/C）· **来源**: [`remediation-plan-2026-07-09.md`](remediation-plan-2026-07-09.md)（P0–P4 分阶段）
> **状态**: P0+P1 已闭环并发布 v0.3.0；本文档为发布后的 **P2/P3/P4 + 技术债** 推进计划。

---

## 0. 当前状态（截至 v0.3.0）

| 维度 | 状态 |
|---|---|
| **发布** | ✅ v0.3.0 已公开发布（2026-07-11）— https://github.com/nehcuh/cmspark/releases/tag/v0.3.0（macos-arm64 / linux-x64 / windows-x64 三平台自包含 zip） |
| **P0 紧急止血** | ✅ 全部完成（C1 WS Origin 鉴权 / C2 history 落盘 / C3 移除 `\|\| true` / C4 zip-slip 预检 / H1 config 0o600 / H2 evaluate validateToken） |
| **P1 发布前必修** | ✅ 全部完成（H3-H10 + M18 + 供应链 C4 收口，共 PR #11–#28） |
| **CI** | ✅ 真绿（companion 707 tests / extension 76 tests / tsc clean / `npm audit --omit=dev --audit-level=high` exit 0） |
| **审计评分** | 4.4/C → P0+P1 后已达「可稳定发布」线；P2 完成预计 ~6.5–7.0 |
| **kimi 终审** | ✅ RELEASE-READY（≥7.0/A on codebase）+ 3 个 release 相关 PR 全 APPROVE |

**关键产出**：发布流水线跑通并验证（详见 [§1](#1-发布流水线如何切下一个版本)）。dry-run 门在 tag 前抓到并修复了 Windows 打包的真 bug（MSYS 路径），证明流程有效。

---

## 1. 发布流水线（如何切下一个版本）

> 完整可复用知识见 memory `release-pipeline-v030`。此处给出操作清单。

**发布标准门（每个 release 必过）**：
1. 目标里程碑 PR 全合 `main` + e2e 绿。
2. **kimi go/no-go 终审**（独立对抗验证：`git log/status/tag/ls-remote`、`gh run view`、`npm audit`、tests、`gh pr/issue list`）→ 明确 GO 才 tag。

**切版本流程**（已验证）：
1. 版本对齐：`companion/package.json` + `chrome-extension/package.json` 同版本号 → **必须** `npm install --package-lock-only` 重生两个 lockfile（`npm ci` 要求 package.json↔lockfile version 同步）→ grep 全部 shipped 版本串：CLI banner（`companion/src/index.ts`）、`chrome-extension/plasmo.config.ts`、`companion/README.txt`（会被 cp 进每个 zip）。
2. PR 合并后：`gh workflow run release.yml --ref main` **dry-run**（build 3 平台，release job 因非 tag 而 skip）。**这是 tag 前的硬门**。
3. dry-run 全绿 → kimi GO → `git tag -a vN.N.N origin/main` + `git push origin vN.N.N` → `release.yml` 自动建 public release。

**已知局限（release body 已声明）**：WS 本地进程握手未做（C1 仅关网页向量，P2 评估）；binary 未 codesign/notarize（Gatekeeper/SmartScreen 警告，待证书）。

---

## 2. P2 — 🟡 稳定性 + 隐私 + 成本（~4 天）

> 排在 P1（尤其 C1）之后——安全纵深类只有 C1 关闭恶意 peer 接入后才有意义。C1 已完成，**P2-1 已解锁**。

> ⚠️ **分析阶段发现的关键权衡**（2026-07-11）：P2-2 的四个 item 并非「快速安全修复」，每个都有真实设计权衡，需独立设计 + kimi 终审，不能批量 rushed。详见各 item 的「权衡」栏。

### P2-1 · 安全纵深（依赖 C1，**建议优先**）— 价值最高
| 任务 | Finding | 文件 | 权衡/注意 |
|---|---|---|---|
| tabUrlCache 页面导航刷新 | M1 | `server.ts:75`、扩展 `background` | 扩展订阅 `chrome.tabs.onUpdated` 推 `tab.url_updated`；companion 缺失条目当「未知→需确认」。**安全价值清晰**：当前缓存可能在地址栏导航/JS 跳转后 stale → 跨域自动批准。1–2h |
| companion 输入侧注入标记 | M2 | `llm/adapter.ts:472` | tool 结果包 `<untrusted>…</untrusted>` + system 指令；重命名 `threats_removed`→`injection_phrase_matches`。2–3h |
| osascript 范围化 | M3 | `server.ts:233` | 加 `auto_approve_dangerous_domains`；含 `do shell script` 等表达式二次确认。1–2h |
| analyze_image 确认门 | M4 | `image-extract-utils.ts:66` | tainted canvas 走确认；明示「认证图片字节将送 <provider>」。0.5d |
| cookie 扩展端 trust 执行 | M5 | `browser-bridge.ts:926` | 扩展端 enforce trusted_domains；list_all_cookies 高危确认；httpOnly 默认脱敏。**安全关键路径**，1d，需细致 kimi 终审 |

### P2-2 · 可靠性收尾 — 每个 item 有真实权衡
| 任务 | Finding | 权衡/注意 |
|---|---|---|
| unhandledRejection 退出 | M6 (`index.ts:442`) | **权衡 = 可用性 vs 清洁度**：当前 handler 只写 crash log 不退出（吞掉 rejection）；改 exit(1) 对齐 uncaughtException。**但代码内无 daemon 自动重启**——fatal rejection 会中断 companion，除非 launchd/systemd KeepAlive 配置。决策点：要么先加 supervisor 重启逻辑再 fatal，要么接受「依赖 OS 守护」。30min 实现，但设计需定。 |
| ~~双 shutdown 合并~~ | ~~M9 (`daemon.ts:484` + `server.ts:2197`)~~ | **✅ 已闭环（PR #49）**：daemon 模式两个 SIGTERM handler racing——`daemon.ts` 同步 `process.exit(0)` preempt `server.ts` 异步 mcp/history/WS 清理（MCP 子进程孤儿化、history 未 flush，回归审计 C2）。合并为 `startServer` 经 async-aware `setupGracefulShutdown` 注册的**单一** handler，index.ts 把 pidFile 清理作 `onShutdown` hook；shutdown 改 async/await 逐步 try/catch；signal 转发保留审计 SIGINT/SIGTERM 区分。已知可接受权衡：handler 装在 startServer 末尾，启动期信号不再清 pid（init 短 + stale pid 自愈）。 | ✅ 已闭环 |
| abort 孤儿消息 | M10 (`adapter.ts` 多处 addMessage) | **消息丢失风险**：abort 后 in-flight addMessage 仍执行会留孤儿消息；但盲目全跳过会丢用户消息/部分 assistant 回复。需逐 site 判断哪些 addMessage 应在 abort 后保留。1–2h，需细致 |
| ~~MCP 子进程 force-kill~~ | ~~M11 (`mcp/client.ts:191`)~~ | **❌ 误报**：SDK `StdioClientTransport.close()`（`@modelcontextprotocol/sdk@^1.0.4`，解析至 1.29.0）已内置 stdin-close → 2s grace → SIGTERM → 2s grace → SIGKILL 阶梯；SIGKILL 不可捕获/忽略，子进程必死。再自己 `kill(pid, SIGKILL)` 既冗余又 race（close 后 `transport.pid` 被 SDK 置 null）。M9（PR #49）已保证 `mcpManager.shutdown()` 被 await，阶梯完整跑完。详见 [`p2-2-m11-mcp-forcekill-audit-2026-07-12.md`](p2-2-m11-mcp-forcekill-audit-2026-07-12.md)。 | ✅ 已闭环 |

### P2-3 · 可观测 + 成本
| 任务 | Finding | 改动 | 工时 |
|---|---|---|---|
| logger 脱敏 + 0o600 | M7 | 复用 history `redactForStorage`；扩 SENSITIVE_KEY_RE 含 url/selector/code/params | 2–3h |
| 日志轮转 | M8 | initDataDir retention 扫除（默认 7/30 天）+ 大小轮转 | 1–2h |
| LLM 并发+usage+预算 | M20 | per-thread in-flight cap(1)；日志记 `usage.total_tokens`；可选 `daily_token_budget`；成功重置 continuousFailures | 1d |
| healthz 端点 | L12 | WS 端口加小 HTTP `/healthz` | 0.5d |

### P2-4 · 配置
| 任务 | Finding | 改动 | 工时 |
|---|---|---|---|
| ~~默认模型改 deepseek-chat~~ | ~~M19~~ | **❌ 误报**：`deepseek-v4-flash`/`v4-pro` 是当前真实 id（DeepSeek 官方 changelog 2026-04-24）；旧名 `deepseek-chat`/`deepseek-reasoner` 反而 2026-07-24 停用。默认保持 `deepseek-v4-flash`。已做：PR #32 启动 `/v1/models` 探测 + 本 PR 启动时自动迁移旧名 → `deepseek-v4-flash`（原子写入 + warn） | ✅ 已闭环 |

**P2 Done 判据**：安全纵深多层化；可靠性 mediums 清零；成本可观测。**→ 总分 ~6.5–7.0。**

---

## 3. P3 — 🟢 可维护性重构（~4 天，可与 P2 并行）

| 任务 | Finding | 说明 |
|---|---|---|
| 前端 god-file 拆分 | M12+M14+L4 | sidepanel 大组件拆分 |
| 前端性能 | M15+M16 | 渲染/重渲染优化 |
| WS 协议类型化 | M21 | 扩展/companion 共享 schema（较大，独立 worktree） |
| 前端/配置杂项 | M13+M17+L1–L9 | 零散 cleanup |
| 文档/版本 | L13+L14 | 同步版本号、补文档 |

> P3 与 P2 无强依赖，可并行；M21（协议类型化）是 P4「协议代码生成」的前置。

---

## 4. P4 — ⚪ 长期重构（按需，~3 天）

| 任务 | 说明 |
|---|---|
| better-sqlite3 替换 sql.js | 同步写、更可靠的持久化（消除 C2 类 flush 风险） |
| WS 协议代码生成（M21 进阶） | 扩展/companion 共享 schema，消除手写 validator |
| 成本面深化 | 基于 P2-3 的 usage 数据做配额/告警 |

---

## 5. 技术债 / 杂项 follow-up

| 项 | 状态 | 说明 |
|---|---|---|
| 根 `package.json` 去除 dompurify | ✅ 本 PR 已清 | `dompurify`+`@types/dompurify` 无任何 shipped 代码引用（mermaid.ts 走扩展自带），已删 |
| 根 `package.json` 其余 deps 审计 | 🔶 待办 | 剩 `@types/js-yaml`/`js-yaml`/`typescript@^6.0.3`——根目录无 .ts 源、CI 不装根 deps，疑似全 stale；`typescript@^6.0.3` 版本号可疑（当下稳定线 5.x）。建议下个 housekeeping PR 一并审计/删除整个根 package.json |
| `codex/cleanup-sync` 分支 | 🔶 待用户定 | 远程已推送、未合 main、单 commit「sync to 0.2.0」（已过时）。非本工作流创建，未擅自删除——**待 owner 确认是否可删** |
| 旧 worktree 清理 | ✅ 已完成 | 11 个已合并 worktree + 分支已清（2026-07-11） |
| 签名证书 | 🔶 长杆 | macOS codesign+notarize / Windows signtool + SBOM（`cyclonedx-npm`），待证书采购 |
| `softprops/action-gh-release` SHA pin | 🔶 非阻塞 | release.yml 当前用 `@v2` moving tag；kimi 建议 SHA pin 或换 `gh release create`（已在 release-pipeline memory 记） |

---

## 6. 优先级建议与排序

按「价值 × 风险 × 依赖」推荐顺序：

1. **~~P2-4 M19~~ 已证为误报**：默认模型 `deepseek-v4-flash` 本就正确；旧名停用风险由 PR #32 探测 + 本 PR 自动迁移闭环。
2. **P2-1 安全纵深**（M1→M2→M3→M4→M5）—— 价值最高，C1 已解锁；M1/M2/M3 先做（小而清晰），M5（cookie）压轴单独 kimi 终审。
3. **P2-2 可靠性**—— ~~M9（双 shutdown）~~ ✅ PR #49 闭环；~~M11（MCP kill）~~ 已证为 SDK 覆盖的误报；M6（fatal rejection）需先决策 supervisor 策略；M10（abort 孤儿）需逐 site 设计。
4. **P2-3 可观测+成本** + **P3**（可并行）。
5. **P4** 按需。

**方法论**（见 memory `methodology-goal-driven-workflow`）：每个 item 走 kimi-gated-fix——worktree → 实现 → 对完整 diff 跑 kimi 终审（`/Users/huchen/.kimi-code/bin/kimi -m kimi-code/kimi-for-coding -p "$(<file)"`，6min 超时）→ NEEDS-FIX 验证后采纳/反驳 → tsc/build/定向测试绿 → push + gh pr create → CI 绿 → merge。`superpowers`/`omx` skill 被标记不安全，禁用。

---

## 7. 变更日志

| 日期 | 变更 |
|---|---|
| 2026-07-12 | M9 闭环（PR #49）：SIGTERM/SIGINT 双 handler race 合并为 startServer 单一 async handler，history.db flush 回归修复；M11 标记为误报/已闭环：SDK `^1.0.4`（解析至 1.29.0）`StdioClientTransport.close()` 已内置 SIGTERM→SIGKILL 阶梯，无需额外 force-kill |
| 2026-07-11 | 初版：v0.3.0 发布后创建；记录 P0+P1 闭环状态、P2–P4 计划、P2-2 权衡发现、技术债 follow-up |
