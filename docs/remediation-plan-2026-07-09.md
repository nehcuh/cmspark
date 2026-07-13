# CMspark — 优化重构计划（基于 2026-07-09 全量审计）

> **日期**: 2026-07-09 · **基于**: [`audit-report-cmspark-2026-07-09.md`](../audit-report-cmspark-2026-07-09.md)（55 findings，总分 4.4/C）
> **关系**: 本计划聚焦 07-09 审计的修复；与 [`optimization-roadmap.md`](optimization-roadmap.md)（2026-05-29 体检，多已完成）、[`optimization-plan.md`](optimization-plan.md) 并存，不互相覆盖。
> **状态**: 待审批 → 执行

---

## 0. 总览

把 55 个 finding 按「风险 × 依赖」分成 5 个阶段。每阶段 = 一个可独立 worktree 的 bundle，内部任务可并行；阶段间有显式依赖。**总分目标**：4.4/C → 发布线 ≥ 7.0/A（P0+P1 完成即达「可稳定发布」）。

| 阶段 | 优先级 | 主题 | 估算 | 阻塞关系 | 建议 worktree |
|------|--------|------|------|----------|---------------|
| **P0** | 🔴 紧急止血 + 验证基建 | **C3-unblock(移除\|\|true,最先做)** + C1 + C4 + C2 + H1 + H2 | ~2 天 | 无 | `fix/p0-critical-stopgap` |
| **P1** | 🟠 发布前必修 | C3-teardown 完整修 hang + 持久化加固 + H6/H7/H8/H9/H10 | ~5 天 | P0 后 | 多 worktree 并行（见 §依赖） |
| **P2** | 🟡 稳定+隐私+成本 | mediums（安全纵深/可靠性/可观测/成本） | ~4 天 | P1（C1）完成后 | `fix/p2-stability-privacy-cost` |
| **P3** | 🟢 可维护性重构 | god-file 拆分 / 性能 / 协议类型化 / 文档 | ~4 天 | 无强依赖 | `refactor/p3-maintainability` |
| **P4** | ⚪ 长期重构 | better-sqlite3 / 协议代码生成 / 成本面 | ~3 天 | 按需 | 各自独立 |

> **⚠️ 优先级修订（采纳 Kimi 独立复核 2026-07-09）**：原版把 C3 放 P1 与其他并列、C4 放 P1。Kimi 指出两点更优：(1) **C3 移除 `|| true` 必须最先做**——它是验证 backbone，C1/C2/C4 的任何修复都需 CI 来证明测试通过，CI 绿-on-red 时无法信任修复结果；(2) **C4 应进 P0**——可远程触发（用户上传 office 文件即 zip-slip RCE）且 officeparser 升级是 breaking，需尽早评估兼容性。故 P0 现含 C3-unblock + C1 + C4 + C2 + H1 + H2。

**总工时 ~18 工作日**，跨多 session。建议每个 worktree 一个 PR，走 `kimi-gated-fix` 流（Design→kimi 改动前复审→Apply→build 验证），阶段末做对抗验证。

---

## 1. 依赖关系图

```
P0-1 (C2 history flush) ──┐
P0-3 (H1 config 0o600) ──┤
P0-4 (H2 evaluate token)─┼──► P0 完成（数据/凭据止血）
P0-2 (C1 WS 鉴权) ────────┘            │
                                      │
        ┌─────────────────────────────┼──────────────────────────┐
        ▼                             ▼                          ▼
  P1-3 (H3/H4/H5 持久化)      P1-1 (C3 CI 修复)           P1-4 (H7 tsc 门)
  ├─ 需 atomicWriteJSON       └─ 含 extension build/tsc 步      │
  │   helper（与 P0-1 共用）                                       │
  │                                                                ▼
  P1-2 (C4/H6 供应链)        P1-5 (H8 签名)              P1-6 (H9 eval 扩展)
                                  │                     P1-7 (H10/M18 a11y)
                                  ▼
                          P1 完成 = 可稳定发布（≥7.0/A）
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
            P2-1 (安全纵深)  P2-2 (可靠性)   P2-3/4 (可观测/成本/配置)
            （依赖 C1 落地后才有意义）
                                  │
                                  ▼
                    P3 (重构，可与 P2 并行)
                                  │
                                  ▼
                    P4 (长期，按需)
```

**关键依赖**：
- **C1（WS 鉴权）是枢纽** — P2-1 的 M2/M3/M5/M22 只有在 C1 落地后才有意义（C1 关闭了恶意 peer 接入，纵深防御才有价值）。所以 P2-1 排在 P1 之后。
- **atomicWriteJSON helper** — P0-1（history 原子 flush）和 P1-3（config/threads 原子写）共用。建议在 P0 就抽出 helper（P0-1 内联实现，P1-3 复用扩展）。
- **C3（CI 修复）解锁真相** — P1-1 移除 `|| true` 后，5 个红用例暴露真实状态；其中可能有真 bug（安全闸门回归），需先分诊再决定是否阻塞发布。

---

## 2. 执行约定（每阶段通用）

每个 code-change 任务遵循：

1. **worktree**：`EnterWorktree` 起独立分支（你的方法论：plan→worktree→分阶段）。
2. **Design**：精确 diff 设计（改哪个文件、哪几行、改成什么）。
3. **kimi 改动前复审**：`kimi -p` 跑 Design，仅 APPROVE 才 Apply（`kimi-gated-fix` 技能）。
4. **Apply + build**：tsc（companion 0 错为基线）+ 相关测试。
5. **对抗验证**：对安全/数据相关改动，Workflow 起独立 agent 尝试反驳「修复确实关闭了风险」。
6. **完成标准**：每任务下方的「Done」必须全绿才合并。

**Done 标准模板**（每任务复用）：
- [ ] tsc 干净（companion 0 错；extension 待 P1-4 后 0 错）
- [ ] 任务指定测试通过
- [ ] kimi 门 APPROVE
- [ ] 对抗验证未发现绕过（仅安全/数据任务）
- [ ] 无回归（相关既有测试仍绿）

---

## 3. Phase 0 — 🔴 紧急止血（~1 天，单 worktree）

**目标**：关闭「正常操作数据丢失」+「凭据 world-readable」+「最高杠杆安全缺口」+「确认/执行绑定断裂」+「可远程触发 RCE」。全部廉价且独立，一个 worktree 一次 PR。

### P0-0 · [C3-unblock] 移除 CI `|| true`（最先做，验证基建）
- **文件**: `.github/workflows/ci.yml:46`
- **改动**: `cd companion && npm test || true` → `cd companion && npm test`。
- **为什么最先**: Kimi 复核的关键洞察——后续 C1/C2/C4 修复都需 CI 证明测试通过；`|| true` 在时无法信任任何修复结果。这一步 5 分钟，但它是整个 P0/P1 的验证 backbone。（hang 的 teardown 修复是更大的活，放 P1-1，不阻塞此步——移除 `|| true` 后 CI 会真实暴露红，反而给 P1-1 的修复提供信号。）
- **验证**: PR 上 CI 步真实 pass/fail（不再永久 in_progress 超时）。
- **工时**: 5 分钟
- **Done**: CI 步骤无 `|| true`；PR check 真实反映测试状态。

### P0-1 · [C2] history.db 落盘 + shutdown 调 close
- **文件**: `companion/src/history/store.ts`（`record():300`、`save():263`、`close():377`）、`companion/src/server.ts`（`shutdown():1522`）
- **改动**:
  1. 抽 `atomicWriteJSON`/`atomicWriteBuffer` helper（tmp+rename，0o600），放 `companion/src/paths.ts` 或新 `io.ts`。
  2. `record()` 末尾调 `this.save()`（用原子写）。考虑 debounce：若担心每 tool call flush 的 IO，先上「每写 flush」（简单正确），P4 再换 better-sqlite3。
  3. `shutdown()` 在 `process.exit(0)` 前：`await historyStore.waitReady(); try { historyStore.close() } catch {}`。
- **验证**: `record()` 10 条 → `process.kill(SIGKILL)` → 重开 db 断言 10 条（当前=0，是 bug）。
- **工时**: 1h（helper + record flush + shutdown close + 测试）
- **Done**: 上述测试绿；shutdown 路径 grep 见 `historyStore.close()`。

### P0-2 · [C1] WS 服务器鉴权（核心）
- **文件**: `companion/src/server.ts`（`WebSocketServer` 创建 `:1287`、connection handler `:1323`）、`chrome-extension/src/background/ws-client.ts`（`:42`）、`chrome-extension/src/background/index.ts`
- **改动**（分两层，可同 PR）:
  1. **Origin 检查（关闭网页向量，~30min）**: `new WebSocketServer({ port, host, verifyClient: (info, cb) => { const ok = ALLOWED_ORIGINS.includes(info.req.headers.origin); cb(ok?200:403, ok?undefined:"forbidden") } })`。`ALLOWED_ORIGINS` = `chrome-extension://<id>` + 扩展 id 白名单（id 可配）。
  2. **共享密钥握手（关本地进程向量，~2-3h）**: companion 启动生成 `randomBytes(32)` 写 `~/.cmspark-agent/ws.token`（0o600）；扩展首消息 `{type:"auth", token}` 携带（经 native messaging 或用户首次粘贴）；非 auth 消息在握手前拒绝。
- **验证**: 单元 `verifyClient` 拒 `Origin: https://evil.com`、接受扩展 origin；集成裸 `ws.connect()` 无 token 不能 `config.set`。
- **工时**: 2–4h（Origin 30min，完整握手含扩展协调 2-3h）
- **Kimi 复核的范围建议**: CMspark 是单用户本地工具，**真攻击面是本地进程而非网页**（HTTPS 页面已被 Mixed Content 挡住，仅 HTTP 页面可连）。故 **A（Origin 检查）是必做**——零破坏、关闭网页向量 + 草率本地脚本；**B（共享密钥握手）对本地进程防护价值有限**（同用户下恶意进程可读扩展 storage/本地文件拿到密钥），属可选增强。若坚持防本地进程，优先「首启生成 token + OS secure 存储」而非静态共享密钥。建议：P0 只做 A，B 留 P2 评估。
- **Done**: 恶意 origin/无 token 连接被拒；扩展正常连接不受影响；C1 的 failure scenario（本地进程/HTTP 页连接）无法复现。

### P0-3 · [H1] config.json 文件权限 0o600
- **文件**: `companion/src/config.ts`（`:171` init 默认写、`:355` saveConfig）
- **改动**: 两处 `fs.writeFileSync(configPath, …, { mode: 0o600 })`；`initDataDir()` 对已存在文件 `fs.chmodSync(configPath, 0o600)`（镜像 `history/store.ts:276`）。顺手把 `logger.ts:91`（M7 的一部分）也加 0o600。
- **验证**: `saveConfig({})` 后 `statSync(configPath).mode & 0o777 === 0o600`；已存 0644 经 initDataDir 后变 0600。
- **工时**: 15min
- **Done**: `ls -la ~/.cmspark-agent/config.json` 显示 `-rw-------`。

### P0-4 · [H2] evaluate 转发前校验 token
- **文件**: `companion/src/server.ts`（`createToolExecutor` evaluate 路径 `:397`）
- **改动**: evaluate 的 `finalParams.security_token` 非空时，调 `securityPolicy.validateToken(token, "evaluate", finalParams.code)`，失配返回错误（镜像 `:711-715` 的 osascript_eval 校验）。
- **验证**: code A 签 token；用 code B + 同 token 调 executor → 断言拒绝。
- **工时**: 30min
- **Done**: 上述测试绿；evaluate 执行前必有 validateToken 调用。

### P0-5 · [C4] 供应链 zip-slip 止血（从 P1 提上来）
- **文件**: `companion/package.json`、`companion/src/file-parser.ts:173`（officeparser 调用点）
- **改动**（止血优先，完整修复见 P1-2）:
  1. `cd companion && npm audit fix`（非破坏解 form-data/js-yaml）。
  2. **decompress zip-slip 止血**：升 `officeparser@7.x`（breaking，需适配 API）或换 zip-slip-safe 提取（`yauzl` + entry 名校验 `resolved.startsWith(dest + sep)`）。若升级风险大需先评估，则**先加 zip-slip 防护 wrapper**包住 officeparser 输出目录（校验解压后无文件逃逸），把 RCE 面先关上，完整迁移留 P1-2。
  3. CI 加 `npm audit --audit-level=high`（companion gating）。
- **为什么进 P0**: Kimi 复核指出——可远程触发（用户上传 office 文件即 zip-slip 任意文件写），且 officeparser 升级是 breaking change 需尽早评估兼容性。
- **验证**: zip-slip PoC office 文档喂入后断言 sandbox 外无写入；`npm audit` companion critical=0。
- **工时**: 0.5–1 天（止血 wrapper 快；完整 officeparser 7.x 迁移留 P1-2）
- **Done**: zip-slip 不可写穿；companion 0 critical 漏洞。

**P0 阶段 Done**：P0-0(CI 解封) + P0-1..P0-5 测试绿；worktree PR 合并；总分 Security/Stability 各 +1.0 左右；**CI 真实转反馈**是后续一切的前提。

---

## 4. Phase 1 — 🟠 发布前必修（~6 天，多 worktree 并行）

P1 内部三组可并行：**A 持久化加固**（P1-3）、**B CI/类型/供应链**（P1-1/P1-2/P1-4/P1-5）、**C 安全前端**（P1-6/P1-7）。

### P1-1 · [C3-teardown] 修测试 hang + 分诊 6 个红用例（`|| true` 移除已在 P0-0）
- **文件**: `.github/workflows/ci.yml`（`:46`，`|| true` 已于 P0-0 移除）、`companion/tests/integration/security-gates.test.ts`、`companion/tests/security/security-policy.test.ts`、`companion/tests/integration/daemon-cli.test.ts`
- **改动**:
  1. （`|| true` 移除已在 P0-0 完成；本项聚焦让测试真实退出 0）
  2. security-gates 的 `after()`/`afterEach()` 关 `wss`/`clientSideWs`，所有 `setTimeout` 加 `.unref()`（`expectNoClientMessage`/`expectClientMessage` helper 的 timer 从未 unref 是 hang 根因）。
  3. security-policy/daemon-cli 同样修 teardown（关 spawned server/lock）。
  4. **分诊 5 个红用例**：`timeout waiting for security.confirmation.request` 可能指示 SecurityConfirmationManager 真实回归——先确认是测试问题还是代码 bug，若是后者则修。
  5. CI 加 `cd chrome-extension && npm ci && npx tsc --noEmit`（与 P1-4 合并；先 informational 再 gating）。
- **验证**: `cd companion && timeout 120 npm test` 真实退出 0（非超时）；CI 在 PR 上转绿。
- **工时**: 0.5 天
- **Done**: npm test 干净退出；CI 绿；5 红用例要么修要么 documented-skip 并开 issue。

### P1-2 · [C4+H6] 供应链漏洞
- **文件**: `companion/package.json`、`chrome-extension/package.json`、`companion/src/`（officeparser 调用点）
- **改动**:
  1. `cd companion && npm audit fix`（解 form-data/js-yaml 非破坏）。
  2. `decompress` critical：升 `officeparser@7.x`（breaking，需适配 API）或换 zip-slip-safe 提取器（`yauzl` + entry 名校验 `resolved.startsWith(dest + sep)`）。
  3. extension：`package.json` 加 `overrides`/`resolutions` 钉 `@parcel/core` 与 `svelte` 可补丁最高版；评估 plasmo 升级路径。
  4. CI 加 `npm audit --audit-level=high`（companion gating；extension 先 informational）。
- **验证**: zip-slip PoC office 文档喂入后断言 sandbox 外无写入；`npm audit` critical=0（companion）。
- **工时**: companion 1 天；extension 2–3 天（plasmo 兼容性核查）
- **Done**: companion 0 critical/high；extension high 数显著下降或 documented blocked-on-upstream。

### P1-3 · [H3+H4+H5] 持久化加固 bundle
- **文件**: `companion/src/config.ts`、`companion/src/threads/thread-manager.ts`、新建 `companion/src/io.ts`（atomicWriteJSON）
- **改动**:
  1. `atomicWriteJSON(path, data)`: `writeFileSync(tmp, …); renameSync(tmp, path)`（复用 P0-1 的 helper）。
  2. **[H3]** `saveConfig`/`saveIndex`/`addMessage`/`updateMessage`/`deleteMessagesFrom`/`createMessagesFile` 全换 atomicWriteJSON。
  3. **[H4]** `config.ts:196` 加 zod schema（已有 `zod^3.23` 依赖）；load 失败改名 `config.json.corrupt-<ts>` + `logger.error`，不静默默认；加 `config_version` 字段。
  4. **[H5]** `saveConfig` 包单 promise 队列（in-process mutex）串行化读-改-写。
- **验证**: 截断 config.json → logger.error + .corrupt-* 保留 + 新默认；两并发 saveConfig 不相交 key 都落盘；SIGKILL 于 addMessage 中途 → 文件可解析为上一好状态。
- **工时**: 2–3 天
- **Done**: 三项测试绿；config/threads 写全原子 + 校验。

### P1-4 · [H7] 扩展 tsc 修 9 错 + CI 类型门
- **文件**: `chrome-extension/src/background/browser-bridge.ts`（`:199/211/212/215/247/270/895/898`）、`background/index.ts:74`、`tsconfig.json`
- **改动**: 为 CDP 结果定义接口（`interface DomNode { root: { nodeId: number; outerHTML?: string } }`、`InjectionResult<T>`）；修 9 处 `as Object`/无类型访问。CI 加 `tsc --noEmit` 门（并入 P1-1 的 CI 改造）。
- **验证**: `cd chrome-extension && npx tsc --noEmit` → 0 错；CI 步 gating。
- **工时**: 0.5 天
- **Done**: tsc 0 错；CI 类型门生效。

### P1-5 · [H8] 发布签名（最低：Node SHA256 校验）
- **文件**: `scripts/package.sh`（`:167/177`）、`scripts/create-dmg.sh`、`scripts/build-windows-exe.ps1`、新 `scripts/verify-node.sh`
- **改动**（分两步）:
  1. **最低成本（0.5d）**: `package.sh` 从 `nodejs.org/dist/SHASUMS256.txt` 拉校验和，下载后 sha256 校验 + 失败即中止；CI/release 断言校验已跑。
  2. **完整签名（2–5d，证书长杆）**: macOS `codesign --deep --options runtime` + `xcrun notarytool submit`；Windows `signtool sign`；生成 SBOM（`cyclonedx-npm`）。
- **验证**: 改 NODE_MIRROR 指向坏镜像 → 下载中止；签名产物 `codesign --verify` 通过。
- **工时**: 0.5d（SHA256）+ 2–5d（签名，阻塞于证书获取）
- **Done**: Node 下载强制校验；有证书后 DMG/exe 签名。

### P1-6 · [H9] evaluate 扩展端门
- **文件**: `chrome-extension/src/background/browser-bridge.ts`（`detectDangerousApis:47`、`evaluate:855`）
- **改动**（二选一）:
  1. **诚实化（0.5d）**: 移除 regex 提示的"控制"语义，文档标注 advisory-only；消费者不依赖 `has_dangerous_apis:false`。
  2. **真 gate（2–3d）**: 用 `acorn` AST，拒 callee 解析为 eval/Function/Reflect/dynamic-property 的 CallExpression。
  - 与 P0-2（C1）/P0-4（H2）配合——扩展端门是纵深，companion 确认+token 是权威。
- **验证**: `detectDangerousApis("window['ev'+'al']('x')")` 修复后返 `["eval"]`（今日返 `[]`）。
- **工时**: 0.5d 或 2–3d
- **Done**: 上述测试绿；advisory 文档或 AST gate 生效。

### P1-7 · [H10+M18] Modal a11y primitive
- **文件**: 新 `chrome-extension/src/sidepanel/components/Modal.tsx`；改 `App.tsx`（SecurityConfirmationDialog `:125`）、`SettingsSlideout.tsx`、`McpServerForm.tsx`、`ThreadList.tsx`、`SlashCommandPopover.tsx`
- **改动**: 抽 `<Modal>`（focus trap + Escape + 焦点还原 + `role=dialog aria-modal`）；SecurityConfirmationDialog 默认焦点设"拒绝"（非破坏）；四 modal 复用。
- **验证**: Playwright 每 modal——Tab 5 次焦点留内、Escape 关闭、焦点还原触发元素。
- **工时**: 0.5–1 天
- **Done**: 5 modal 的 Playwright a11y 测试绿；WCAG 2.1 SC 2.1.2/2.4.3 满足。

**P1 阶段 Done**：CI 真绿；companion 0 critical/high 漏洞；config/threads 原子+校验；扩展 tsc 0 错；安全弹窗键盘可达。**→ 总分跨过 7.0/A「可稳定发布」线。**

---

## 5. Phase 2 — 🟡 稳定性 + 隐私 + 成本（~4 天）

> 排在 P1（尤其 C1）之后——安全纵深类只有 C1 关闭恶意 peer 接入后才有意义。

### P2-1 · 安全纵深（依赖 C1）
| 任务 | Finding | 文件 | 改动 | 工时 |
|---|---|---|---|---|
| tabUrlCache 页面导航刷新 | M1 | `server.ts:59`、扩展 `background` | 扩展订阅 `chrome.tabs.onUpdated` 推 `tab.url_updated`；companion 缺失条目当"未知→需确认" | 1–2h |
| companion 输入侧注入标记 | M2 | `llm/adapter.ts:472` | tool 结果包 `<untrusted>…</untrusted>` + system 指令；重命名 `threats_removed`→`injection_phrase_matches` | 2–3h |
| osascript 范围化 | M3 | `server.ts:233` | 加 `auto_approve_dangerous_domains`；含 `do shell script` 等表达式二次确认 | 1–2h |
| analyze_image 确认门 | M4 | `image-extract-utils.ts:66` | tainted canvas 走确认；明示"认证图片字节将送 <provider>" | 0.5d |
| cookie 扩展端 trust 执行 | M5 | `browser-bridge.ts:926` | 扩展端 enforce trusted_domains；list_all_cookies 高危确认；httpOnly 默认脱敏 | 1d |

### P2-2 · 可靠性收尾
| 任务 | Finding | 改动 | 工时 |
|---|---|---|---|
| ~~unhandledRejection 退出~~ | ~~M6~~ | **✅ PR #51**：kimi 裁决选项 A——提取 `crash-handlers.ts`（`writeCrashLog` + `installFatalHandlers`，unhandledRejection/uncaughtException 均 `exit(1)`），index.ts 调用。可测试 seam 仿 daemon.ts `setupGracefulShutdown` 先例；+3 spawn 测。supervisor 崩溃重启作独立 follow-up（不新增缺口，uncaughtException 早已 fatal）。RFC [`p2-2-m6-unhandled-rejection-exit-rfc-2026-07-13.md`](p2-2-m6-unhandled-rejection-exit-rfc-2026-07-13.md) | ✅ 已闭环 |
| ~~双 shutdown 合并~~ | ~~M9~~ | **✅ PR #49**：startServer 经 async-aware `setupGracefulShutdown` 注册单一 handler，index.ts 传 `onShutdown`（pidFile）；shutdown 改 async/await 逐步 try/catch；signal 转发保留审计区分。history.db flush 回归修复。 | ✅ 已闭环 |
| ~~abort 孤儿消息~~ | ~~M10~~ | **✅ PR #52**：kimi 裁决 F1-b/F2-a/F3-a/F4-a——`adapter.ts` 提升 `assistantContent`+`savedAssistantId` 到 round-loop 作用域；tool 循环顶部 `if (signal?.aborted) break`；tool 异常 catch 重抛 abort；round-loop abort 分支 `deleteMessagesFrom(savedAssistantId)` rollback 整轮 + 未持久化时保非空 `assistantContent` 为 text-only。根因：assistant 消息持久化（含 N tool_calls）后才跑 tool 循环，早退还剩 tool_calls 无结果→下次 400。+3 fake-LLM-server 集成测（仿 m2 先例）。RFC [`p2-2-m10-abort-orphans-rfc-2026-07-13.md`](p2-2-m10-abort-orphans-rfc-2026-07-13.md)。**P2-2 全 4 项闭环** | ✅ 已闭环 |
| ~~MCP 子进程 force-kill~~ | ~~M11~~ | **误报**：SDK `@modelcontextprotocol/sdk@^1.0.4`（解析至 1.29.0）已内置 SIGTERM→SIGKILL 阶梯；M9 保证阶梯完整跑完。详见 [`p2-2-m11-mcp-forcekill-audit-2026-07-12.md`](p2-2-m11-mcp-forcekill-audit-2026-07-12.md) | N/A |

### P2-3 · 可观测 + 成本
| 任务 | Finding | 改动 | 工时 |
|---|---|---|---|
| ~~logger 脱敏 + 0o600~~ | ~~M7~~ | **✅ 已闭环（PR #53）**：0o600 部分 H1 阶段已做；脱敏部分 kimi 裁决 Option B（URL 净化保审计，非字面整值脱敏）——新增 `redactUrl()`（剥 userinfo + 脱敏 secret query param 含 `id_token`/`code`）+ `redactLogData` 三分支 + 防御性 `\bcode\b`/`\bparams\b`（跳过 `selector`）；kimi 终审 2 NEEDS-FIX（id_token 假阴性 + params 子串假阳性）已修；+13 测，842 绿 | ✅ |
| 日志轮转 | M8 | initDataDir retention 扫除（默认 7/30 天）+ 大小轮转 | 1–2h |
| LLM 并发+usage+预算 | M20 | per-thread in-flight cap(1)；日志记 `usage.total_tokens`；可选 `daily_token_budget`；成功重置 continuousFailures | 1d |
| healthz 端点 | L12 | WS 端口加小 HTTP `/healthz` | 0.5d |

### P2-4 · 配置
| 任务 | Finding | 改动 | 工时 |
|---|---|---|---|
| 默认模型改 deepseek-chat | M19 | `config.ts:84`；启动 `/v1/models` 探测 | 15min |

**P2 阶段 Done**：安全纵深多层化；可靠性 mediums 清零；成本可观测。**→ 总分 ~6.5–7.0。**

---

## 6. Phase 3 — 🟢 可维护性重构（~4 天，可与 P2 并行）

### P3-1 · [M12+M14+L4] 前端 god-file 拆分
- `App.tsx`(1104) → 拆 `SecurityConfirmationDialog.tsx`/`Header.tsx`/`InputArea.tsx`(替换死代码)/`DisconnectedBanner.tsx`/`LogBar.tsx`/`HighlightedCode.tsx`（无行为变化 + 快照测试）。
- `useWebSocket.ts`(450 switch) → 抽 `messages/{connection,downloads,security,threads}.ts` 纯 handler。
- 删 `components/InputArea.tsx`/`ConnectionStatus.tsx` 死代码。
- 工时：1–2 天。Done：组件快照一致；hook handler 可单测。

### P3-2 · [M15+M16] 前端性能
- `react-virtuoso <Virtuoso followOutput>` 替 `messages.map`（兼得自动滚，顺带修 L5）。
- Header/BottomBar/InputArea 包 `React.memo`；或拆 store 让 `streamingContent` 独立 slice 只 ChatView 消费。
- 工时：1 天。Done：1000 消息 DOM 节点 <30；Header 渲染 ≤1/token 批。

### P3-3 · [M21] WS 协议类型化（较大，独立 worktree）
- 定义 `type ClientMessage = {|type:"chat.create";...|} | ...` discriminated union；`validateWsMessage(msg:any)` → zod `parseClientMessage(raw:unknown)`。
- 工时：1–2 天。Done：编译期未处理 type 是错；205 any 显著下降。

### P3-4 · [M13+M17+L1–L9] 前端/配置杂项
- M13 重连按钮发 `reconnect.now`；M17 用 `<ConfirmDialog>` 替原生 confirm；L5–L9 顺带修。
- 工时：1–2 天。

### P3-5 · [L13+L14] 文档/版本
- 重生成 TESTING.md（find tests）；CLAUDE.md 测试计数；06-23 审计加 [PATCHED]；统一 version 或加 protocol_version 握手；加 CHANGELOG + tag。
- 工时：0.5–1 天。

---

## 7. Phase 4 — ⚪ 长期重构（按需，~3 天）

| 重构 | 动机 | 风险 | 工时 |
|---|---|---|---|
| [C2/L10] history 迁 better-sqlite3 | 修 C2 根因 + 解 O(n) export；原生 WAL 无需 flush | 原生模块跨平台打包（canvas 先例） | 1d |
| [M21 进阶] WS 协议代码生成 | 扩展/companion 共享 schema，消除手写 validator | 大面积签名变更 | 1–2d |
| [M20+L12] 成本/可观测面完整 | 无人值守 daemon 预算追踪 + /metrics 仪表盘 | — | 1–2d |

---

## 8. 风险与回滚

- **P0-2（C1 WS 鉴权）兼容性风险最高**：握手密钥需扩展与 companion 协调升级，旧扩展连新 companion 会失败。缓解：Origin 检查先上（无破坏），握手密钥作为 v2 协议，保留一个版本的「无 token 降级窗口」+ 文档引导。
- **P1-2 officeparser 7.x 是 breaking**：API 变更可能影响 office 解析路径。缓解：先在分支跑 officeparser 测试集，确认 parse 行为不变再升。
- **P1-1 分诊 5 红用例**：若发现是真 bug（非测试问题），则安全闸门有现行回归，需在 P1 内修复（可能扩大 P1 范围）。
- **每个 PR 小且可回滚**：worktree + 单 PR + kimi 门，任一阶段可独立 revert 不影响已合并阶段。

---

## 9. 进度跟踪

> 勾选即完成。建议每阶段末更新本表 + commit。

- [ ] **P0** 紧急止血（P0-1..4）
- [ ] **P1** 发布前必修（P1-1..7）→ **可稳定发布 ≥7.0/A**
- [ ] **P2** 稳定+隐私+成本（P2-1..4）
- [ ] **P3** 可维护性重构（P3-1..5）
- [ ] **P4** 长期重构（按需）

**首推起点**：P0（1 天，4 个廉价且独立的止血修复），一个 worktree 一次 PR，立即把数据丢失和最高杠杆安全缺口关掉。
