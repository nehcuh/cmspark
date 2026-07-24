# App Tab 设计草案 — 对抗审查裁决

> **日期**: 2026-07-18 · **对象**: `app-tab-design-draft.md` · **Verdict**: `DESIGN SOUND WITH MANDATORY AMENDMENTS`

## 承重声明核验（属实）

- W7 Q5 确有 `auto_approved_apps` 预留先例（但是 deferred 决策，非已 ship 代码）
- `bindingPayloadFor` 单点可扩展，**但 footgun**：`default: return ""`——tool 进 gate 忘扩 switch → 空绑定可重放；且 gate 是**三处接线**（server.ts:359 名单 + bindingPayloadFor + executor validate 分支）
- wrapUntrusted 为普适包裹（Option C）：host_cli 输出不加代码也会被包，`PAGE_CONTENT_TOOLS` 仅影响 source label 精度；若造 `source="cli"` 需同步改 Rule 11 文本
- L2 gate 插入点属实；**注意 `detectCriticalApis(code)` 对 host_app 拿到空 code → CRITICAL_API_GATE floor 对新 tool 不生效**，dangerous→biometric floor 是需新建机制；dialog risk preview 需自供
- Chrome sidepanel 拿不到完整路径属实（仓内 KnowledgeSubPanel 已有同坑先例，走 companion-side 方案）

## Findings

| # | Severity | 要点 | 修订 |
|---|---|---|---|
| D1 | **BLOCKER** | **Vault blacklist 不遗传到 `win.app.*`/`win.cli.*` 命名空间**：exact-match set 仅在 host_read/host_write 路径强制。利用链：`chrome.exe` 加为 `win.cli.chrome` + `--headless --dump-dom` → 读任意已登录会话 DOM；`op.exe`/`bw.exe`/`wt.exe` 同理 | add validator 做 basename→vault 映射检查 + 显式 deny 清单；CLI track 全量适用 vault blacklist；GUI vault app 禁止挂模板 |
| D2 | MUST-FIX | add-confirm 用 L2 不够：originWs 绑 socket 不绑人，compromised renderer 可自批；Hello 是 OS-hosted、companion-side spawn，renderer 无法伪造，fallback 机制现成；add-auto 是**落盘持久授权**（vs L2 批一次性 op），不对称性要求更高 tier（W7 Blocker 1 同哲学）；顺带发现 `settings.set` 开 god-mode 在 companion 侧无任何 challenge | add-auto / 升级→auto / drift re-approve 三处一律 **biometric（manual-nonce fallback）**，弃 L2 |
| D3 | MUST-FIX | lolbin 枚举不可能收敛：已漏 pwsh/cscript/msbuild/installutil/forfiles/pcalua/control/任意解释器(python/node/AutoHotkey)/wt.exe/explorer(shell:) | **采纳结构规则为强制项：auto 仅对 L0 无参 launch 生效，凡带参数的 op（含模板）在 auto 下也强制 L2**；blocklist 补 basename 后降为纵深；UI 文案「auto = 仅启动免确认」 |
| D4 | MUST-FIX | Stretch「thread-trust 泛化到 launch」与 W7 Blocker 1（read-only 锁，"collapses the tier into ask-once"）正面冲突——launch 是 state-changing | 砍掉 Stretch；或限定 policy=ai + L0-only 并书面论证；或由 owner 正式推翻 W7 lock（锁是决策不是机制） |
| D5 | MUST-FIX | preset 条目策略未定义 | preset 一律 ship `manual`（或 `ai`）；升 auto 走 D2 biometric 门；探测路径在 user-writable 目录时禁 auto + 黄标 |
| D6 | MUST-FIX | slot 正则不够：MSVCRT quoting vs 自定义解析可被 `"` 重切；`@file` 响应文件约定；**option injection**（slot 值以 `-`/`/` 开头即注入 flag） | per-slot **字符集白名单**（非黑名单）+ 默认拒 `-`/`/`/`@` 前缀（除非声明 flag_value）+ 禁 `"` `%` `!` + 长度上限 + **exec 时复验**（防 config 直改绕过 add 校验） |
| D7 | MUST-FIX | 「3s 内即退→标注可疑退出」误伤：单实例应用（网易云 stub launcher、Spotify）正常成功路径就是 hand off 后立即退出——owner 核心场景会被误标 | 改为用语义化检查（PS 枚举查同名镜像/MainWindow 存在性）→「已在运行 / 已唤起」；quick-exit 仅作启发式 |
| D8 | MUST-FIX | 「手动粘贴路径」是 social bridge：LLM 虽无 add tool，但可以**说话**诱导用户粘贴 evil.exe 并设 auto | add dialog 必须渲染 signer 状态、blocklist 判定、user-writable 警告、来源标记（手动输入 vs 系统枚举）；§7.5 显式命名 paste-path 为 social bridge |
| D9–D11 | NIT | Rule 11 文本随 source 词汇同步；assert x64 companion（WOW64 重定向）；explorer.exe 双重身份写明内部机制豁免 + AUMID 正则 `^[\w.]+\![\w.]+$` | 随实现处理 |
| D12 | scope | P1 镀金：**L1 templates 是最大镀金项**（网易云无参数化控制；D3 规则下 auto 模板反正强制 L2，买不到免确认价值却引入整个 slot 攻击面） | **L1 → P2**；注册表 Uninstall 枚举 → P2；preset 收敛到 1 个；P1 = App tab + 枚举添加 + L0 launch + 三档 policy + 安全三件套 + 审计 + 索引注入 |

## Q1–Q5 结论

1. **Q1**：采纳结构规则为强制项（见 D3），blocklist 降为辅助。
2. **Q2**：字符集白名单 + 反 option-injection + exec 复验（见 D6）。
3. **Q3**：add-auto 必须 biometric（见 D2，三条独立证据链）。
4. **Q4**：mtime+size 快路径可接受（TOCTOU 攻击者已有同用户执行权）；add 时全量 hash + auto app per-exec 快检 + 周期全量；**drift re-approve 必须走 D2 biometric 门**（否则成为绕过侧门）。
5. **Q5**：要确定性兜底，做靶向版——「本 thread 自上一个真实 user message 以来见过 CLI 输出 ⇒ host_app/host_cli 的 state-changing op 强制 L2、auto 按 ai 降级处理，见到下一个真实 user message 清除」。插入点已验证存在（adapter.ts wrap 处置 flag，server.ts skipConfirmation 处消费）。browser 工具侧残余接受。

## 接线警示（实现期）

host_app/host_cli 进 L2 gate 是**三处接线**（tool 名单 + bindingPayloadFor switch + executor validate 分支）；漏扩 switch 会因 `default:""` 退化为空绑定可重放——需测试断言两 tool 的 binding payload 非空且含 canonical params。
