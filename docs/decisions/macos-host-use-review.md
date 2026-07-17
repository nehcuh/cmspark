# macOS (darwin) host-use 安全审计报告

> **日期**: 2026-07-18 01:20 · **基准**: Windows 实现的安全清单（plan §D 15 条 + adversary A1–A7）
> **范围**: 现有 darwin 实现（本分支未改动 darwin，审计对象为 tag `computer-use-w8-snapshot` 上的现状）
> **审计方式**: 只读评审 agent，全部结论附 file:line 证据

## Verdict

macOS 实现的**安全骨架完好**：blacklist 顺序正确（vault → whitelist）、biometric tier 在 executor 内无条件执行且 cancel 无降级、所有 LLM 值走 argv、L2 gate 平台无关、TargetId consume 侧有 re-validation。**但存在 2 个功能性 BLOCKER + 4 个 MUST-FIX**（详见下表），属真实缺陷而非文档化偏差。

## Findings

| # | Severity | Evidence | 问题与修复建议 |
|---|---|---|---|
| M1 | **BLOCKER** | `darwin/index.ts:74-89`；`blacklist.ts:52-56`；`server.ts:395-396` | `host_read` 白名单 W7 已扩到 Notes/Finder，但实现从未分支——对 `com.apple.Notes`/`com.apple.finder` 的读请求**静默返回 Mail 数据**；thread-trust 按 app 授权，"信任 Notes"实际放行 Mail。修复：按 application 分支，未实现的诚实 throw（对齐 win/index.ts:39-43）。 |
| M2 | **BLOCKER** | validator `darwin/adapter.ts:29-30`；生产者 `list-files.applescript:75`、`list-notes.applescript:51` | 生产者输出的 TargetId 几乎必含 `.` `%` `:` `/` 等字符，validator 正则只允许 `[a-zA-Z0-9]` → `listReadTargets` 全量过 validator（adapter.ts:93）→ **note/file listing 在真实数据下必然抛错**，W7 的 list-notes/list-files 实际是坏的。修复：生产者侧统一 base64url 编码（win 的做法），或放宽正则并对齐运行时规则。 |
| M3 | MUST-FIX | `host.swift:135` vs `read-mail.applescript:59` | Swift 侧 `read-message` 拼 JSON 不转义——邮件含 `"` 或 `\` 即产生非法 JSON，该邮件永久读取失败。修复：Swift 侧补等价 jsonEscape。 |
| M4 | MUST-FIX | `darwin/adapter.ts:32-41` vs `darwin/index.ts:31-46` | 两份 resolveHostBinary 不同步：adapter 只有单一路径候选，DMG/打包安装下 `hostRead` 能用但 `readOne`/`writeOne`/`listReadTargets` 全部 ENOENT。修复：抽共享 resolver。 |
| M5 | MUST-FIX | `host.swift:99-103,121` | read-message 的引号守卫校验了**错误的定界符**（拒绝 `'` 但 account 实际插入双引号上下文，`"`/`\` 被放行）。当前靠 TS 正则兜底不可利用；binary 被直接调用即成注入。修复：改用 `appleScriptEscape` 逻辑拒绝 `"` 和 `\`。 |
| M6 | MUST-FIX | `darwin/adapter.ts:186-194` + `host.swift:292-307` | Finder move 零路径校验：相对路径按继承的 cwd 解析（不可预测）、symlink source 会移动目标本体、destination 不要求绝对路径。修复：TS 侧拒绝非 `/` 开头路径（廉价的 win rule-4 对齐），注释声明 symlink 语义。 |
| M7 | NIT | `host.swift:239` | `appleScriptEscape` 误拒单引号 → `John's file` 类路径被误拒。 |
| M8 | NIT | `host.swift:349-356`；`read-mail.applescript:39` | TS 传的 `--limit`/`--max-chars` 被 binary 静默丢弃（maxChars 硬编码 500），契约不诚实。 |
| M9 | NIT | 多处 | 陈旧注释成片（Notes/Finder "not yet implemented" 实际已实现等）。 |
| M10 | INFO | `darwin/adapter.ts:111-121` | readOne vault 复查是 vacuous check（正是 A6 告诫 win 勿复制的模式）——无害但建议注释说明。 |
| M11 | INFO | `tests/host-use-darwin-adapter.test.ts` | darwin 测试只有 validator 层，缺 spawn 级 round-trip 测试（stderr 透传、伪造 id 注入、生产者→validator round-trip）——M2/M3 正是这层测试能抓到的缺陷。建议引入 win 的 PsRunner DI 模式。 |

## Checklist 答卷（10 项）

1. Subprocess injection — ✅（全部 argv，无 `osascript -e` 拼接，无 `do shell script`；隐患 M5）
2. Finder move 路径处理 — ⚠️（引号注入已防；M6/M7）
3. TargetId validator 严格性 — ❌（M2 生产者↔validator 字符集不匹配）
4. Blacklist — ✅（覆盖对等、顺序正确、god-mode 不可绕过）
5. Touch ID 子进程契约 — ✅（nonce TS 生成、echo 严格校验、60s 超时、禁密码回退、cancel 无降级）
6. JSON 解析契约 — ⚠️（解析端诚实；M3 输出端缺陷）
7. Error surfaces — ⚠️（TCC 正确抛错；M1 静默错数据、M8 静默丢参数）
8. originWs / confirmation 流程 — ✅（darwin 无 WS nonce 流程，A1 不适用）
9. Tests — ⚠️（M11）
10. 其他 — M4/M9/M10；`server.ts:1460` Linux 报错文案略陈旧

## 文档化偏差（非缺陷）

- darwin Finder move 无 allowlist（win 的 W-1 是显式 win-only 加固；darwin 依赖 TCC + biometric-per-write）
- `CMSPARK_HOST_BIN` env 覆盖（生产禁用 + code-sign TODO 已记录，与 win 同策）
- move 的 TargetId decorative、source 走 payload（W6 注释声明的 Phase 2 事项）
- note create-only / update/delete throw / file content 不入 host_read（与 win 既定 parity）
- biometric nonce 是审计绑定而非生物识别证明（两端一致的已声明威胁模型）

## 建议处置

- M1/M2 建议立 GitHub Issue（可复现路径明确）；M3–M6 可合一个 "darwin hardening" issue 或并入同一修复 PR
- M11 测试补齐可与修复同 PR 进行
