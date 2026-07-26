# 产品结论：场景化助手 + Mini Terminal（libghostty）

| Field | Value |
|-------|--------|
| Status | **决策已锁定**（§10 勘误 + §11 用户确认） |
| Date | 2026-07-26 |
| Verdict | **APPROVE_WITH_CHANGES**（平台层仍成立；企业 SKU 下放宽 NetSec/终端，**非** CWS 默认能力） |
| Brief | `docs/decisions/v1.3/scenario-packs-libghostty-brief-20260726-190422.md` |
| Reviews | Claude `docs/audit/reviews/scenario-packs-claude-20260726-190422.md`；Pi `docs/audit/reviews/scenario-packs-pi-r2-20260726-190647.md`（r1 误跑全库审计可忽略） |
| Amendment | 2026-07-26 用户澄清：能力为**企业内置**，经**本地安装/自行配置**，非 Chrome 商店分发能力 |

---

## 0. 一句话结论（修订后）

**值得做的仍是「任务包 / Mission Pack」组合层；能力按「分发通道」分档。**

| 通道 | 能力姿态 |
|------|----------|
| **CWS / 轻量消费端** | 浏览器 agent + 只读/被动安全 Pack；**不**捆绑扫描器与自由 shell |
| **企业本地安装（Companion 安装包 + 扩展侧载/企业策略）** | 可启用 **Enterprise Capability Modules**：DevSec / NetSec / Shell / 自定义 Pack；由本机安装与管理员/用户配置开启 |

原提案四条线不能平级立项为「扩展商店功能」；在 **企业本机安装** 前提下，可升级为 **可选企业能力模块**，挂在同一 Pack 框架下。终端仍是 **Companion PTY + UI**，不是扩展内原生 libghostty。

---

## 1. 流程与证据

### 1.1 方法

| 步骤 | 产出 |
|------|------|
| 路由覆盖 | vibe 推荐 RIPER；因用户未显式要求 RIPER，改用 brainstorming + 对抗 agents + omx-ask 外审 |
| 项目上下文 | SkillEngine / knowledge RAG / MCP / L0·L1·L2 / security-confirmation 已具备组合面 |
| libghostty 调研 | 官方 embeddable C/Zig；WASM 规划中；社区 `ghostty-web` ~400KB WASM + xterm.js API（MIT） |
| 对抗 agent×3 | 产品击杀 / 产品钢化 / 技术可行性 |
| 外审 | Claude **APPROVE_WITH_CHANGES** (82%)；Pi **APPROVE_WITH_CHANGES** (85%) |

### 1.2 共识矩阵

| 议题 | 对抗击杀 | 钢化/机会 | 技术 | Claude | Pi | **综合** |
|------|----------|-----------|------|--------|-----|----------|
| Scenario / 任务包（配置组合） | Keep 叙事 | 核心楔子 | YAML→Thread 字段 | **P0 SHIP** | **SHIP 打包层** | **做（平台层）** |
| Dev 安全助手 | Pivot 被动 skill | P0 竖切 AppSec | L1 读页 + MCP 本机 | Pivot PRD 威胁建模 | 砍支柱，留 1 skill | **做（首个 Pack 实例）** |
| 白盒/Qwen 深度集成 | Kill/Defer | 非 P0 | 扩展内不现实 | 不做 SAST 竞争 | Kill 平台化 | **不做产品引擎** |
| 网络扫描/捆绑工具 | **Kill** | MCP 自备后期 | 技术易、政策难 | **Kill bundle** | **Kill** | **Kill** |
| 页面源码审计 | Keep（已有） | 并入 Pack | `get_page_html` | 并入 DevSec | 仅 skill | **做（skill，非支柱）** |
| 开放定制 | 已有，非独立功能 | P1 fork Pack | 同 Pack 格式 | Pack SDK 自然支持 | 打包即开放 | **做（Pack 格式副作用）** |
| libghostty 原生进扩展 | Kill | 不进楔子 | **不可行** | Never native | Wait/Never | **不做** |
| ghostty-web / xterm + PTY | Kill（优先） | P2 可选 | Cockpit only | Substitute P1 | Substitute L2 工具 | **P2 可选；P0 用 tool card** |

---

## 2. libghostty / Mini Terminal — 技术结论

### 2.1 能做什么、不能做什么

| 路径 | 可行？ | 说明 |
|------|--------|------|
| Chrome 扩展 **链接原生 libghostty** | ❌ | MV3 扩展是 JS/WASM 沙箱，不能 link 原生 C/Zig |
| 扩展内 **WASM VT 渲染**（ghostty-web / xterm.js） | ✅ 技术可行 | ~400KB；需注意 CSP/WASM 加载；Side Panel 320px 体验差 |
| **真 shell** | ✅ 仅 Companion | 需 `node-pty`（或同类）经现有 WS 流到 UI；扩展本身无 PTY |
| 官方 libghostty WASM 全量 | ⏳ 规划中 | 等官方成熟前 **无必要** 自建；社区 ghostty-web 已覆盖「前端 VT」 |
| 终端 UI 单独交付 | ❌ 假产品 | 无 PTY 的终端是空壳（ghostty-web demo 也绑真实 shell） |

### 2.2 概念纠偏（全员强调）

> **终端模拟器 UI ≠ 任意 shell 能力。**  
> libghostty / ghostty-web / xterm.js 只解决「怎么画 VT」；命令执行、权限、审计在 Companion。  
> 交互式全功能 PTY 若无确认/白名单，会旁路现有 `osascript_eval` 确认叙事，等于新开一条高危通道。

### 2.3 推荐姿态

1. **P0：不做终端 UI** —— 用结构化 tool card（命令、退出码、截断输出）覆盖「跑一条扫描/ linter」需求。  
2. **P2 可选**：Cockpit 内 **xterm.js 或 ghostty-web** + Companion `node-pty`；命名建议 **「Cockpit Shell」**，默认强确认 / 命令白名单，session 按 `thread_id` 隔离。  
3. **不追 libghostty 原生集成** 作为差异化卖点；不在 Side Panel 塞 mini terminal 主叙事。

---

## 3. 产品模型：Mission Pack（任务包）

### 3.1 定义

**Mission Pack / 任务包** = 可安装的 **Thread 配置模板**，不是新执行引擎。

| 层 | 内容 | 新 runtime？ |
|----|------|--------------|
| Skills | 威胁建模 / 页面审计 checklist 等 | 否 |
| Knowledge | OWASP / 公司基线 / 漏洞模式 RAG | 否 |
| MCP 引用 | 可选 GitHub、filesystem、用户自备 semgrep 等 | 否 |
| Tool policy | `tool_whitelist` / 硬禁高危 | 否（只能收窄，不能放宽全局 security） |
| System prompt overlay | 场景人设 + 输出模板 | 否 |
| UI 表皮 | 一键启用、清单进度、导出 | 轻量 |

实例化时写入已有字段：`active_skill_ids`、`knowledge_selection_mode`、`active_mcp_server_ids`、`tool_whitelist`、`config_override`、`pinned_tabs` 等。

建议最小 manifest（示意）：

```yaml
id: appsec-prd-review
name: 应用安全审查
min_capability: L1
skills: [threat-model-stride, page-security-audit]
knowledge: [owasp-baseline]
mcp_servers: []          # 可选 github / filesystem
tools_allow: [list_tabs, navigate, get_page_text, get_page_html, screenshot]
tools_deny: [host_computer]
system_prompt_append: "..."
workspace: { type: none }  # 后续可 local_path
prohibits_relaxing_security: true
```

### 3.2 楔子（Who / When / JTBD）

| 维 | 定义 |
|----|------|
| **Who** | 兼做安全的应用工程师 / 小团队全栈 / Tech Lead（非专职红队） |
| **When** | 对着浏览器里的 PR、PRD、管理后台、Swagger 做上线前风险过一遍 |
| **JTBD** | 「对着真实页面/文档，按可重复清单做威胁建模与审查，产出可贴进 PR/工单的结论；高风险动作始终确认」 |

**非目标**：替代 Burp、替代 CI SAST、替代 Cursor 写代码主路径、替代 Kali。

### 3.3 与 L0 / L1 / L2 的关系

- Pack **映射**最低能力档（`min_capability`），不引入第 4 种安全产品模式。  
- 产品 L0/L1/L2 与安全 Layer **正交**；Pack 不得静默打开 God-mode / `auto_approve_dangerous`。

---

## 4. 四条原提案的处置

### 4.1 开发安全助手 → **Pivot 为首个 Mission Pack**

| Keep | Cut |
|------|-----|
| Web PRD / 附件威胁建模（STRIDE 等） | 自建 SAST 引擎 / 与 CodeQL·Snyk 正面对打 |
| 已打开页 / PR 页上下文审计 | 捆绑 Qwen 审计「产品」分发 |
| 可选：thread 绑定本机 `workspace_root` + MCP semgrep/gh（P1） | 扩展内白盒扫盘 |
| 报告模板 + Obsidian 导出联动 | 自动 exploit / 未确认写生产 |

### 4.2 网络安全助手 → **企业模块可做；CWS 默认 Kill**

| 通道 | 姿态 |
|------|------|
| CWS / 默认安装 | **Kill** 主动扫描与工具捆绑（原结论不变） |
| 企业本地安装 | **Allow as opt-in module**（见 §10）：端口/服务探测、用户自备或安装器可选捆绑工具；**强制**目标 scope、授权声明、审计日志 |

页面源码审计：两通道均可，作为 skill（已有 `get_page_html`）。

**仍有效的红线（与分发无关）**  
未授权对第三方资产扫描的法律责任；产品必须默认「仅允许声明范围内目标」，不能一键扫公网任意 IP。

### 4.3 用户自定义 → **企业侧的主路径，不是口号**

Skills / Knowledge / MCP 已开放。企业场景下「开放性」= **本地 Pack/模块目录 + 安装器可选组件 + 管理员策略**，比 CWS 应用市场更契合。

### 4.4 Mini Terminal → **企业模块可前置；仍非扩展原生 libghostty**

| 通道 | 姿态 |
|------|------|
| CWS / 默认 | P0 不做；P2 可选 Cockpit Shell |
| 企业本地安装 | **可与 DevSec/NetSec 同批规划**：Companion `node-pty` + Cockpit（xterm.js 或 ghostty-web）；强确认或企业策略白名单 |

见 §2、§10。技术边界不变：扩展不能 link 原生 libghostty。

---

## 5. 推荐路线图（分通道）

### P0 — 全通道共用：Pack 平台 + 轻量 AppSec

1. **Mission Pack 格式 + 本地安装路径**（`~/.cmspark-agent/packs/` 或安装器写入）  
2. **官方 Pack：应用安全审查**（威胁建模 + 页面审计 + 基线 knowledge）  
3. 成功标准：真实审查次数、报告落地、零未确认高危执行  

### P1 — 企业能力模块骨架（本地安装 SKU）

- `capability_profile: community | enterprise`（或安装时勾选组件）  
- **DevSec 深化**：`workspace_root` + folder-picker + 本机/捆绑 semgrep 类工具 via MCP 或 Companion 适配  
- **Shell 模块（可选组件）**：Cockpit + PTY；策略：确认 / 命令白名单 / 审计  
- **NetSec 模块（可选组件）**：探测工具 + **目标 allowlist** + 每次任务授权文案  
- Pack fork / 企业私有 knowledge 目录导入  

### P2 — 深化与运维

- 企业策略文件（谁可开 NetSec/Shell、默认 scope）  
- 可选捆绑扫描器二进制的签名/校验/更新通道  
- Pack 内部分享（不走 CWS）  

### 明确不做清单（修订）

- ❌ 扩展内嵌**原生** libghostty  
- ❌ 把 NetSec/自由 shell 放进 **Chrome Web Store 默认能力**  
- ❌ Pack 静默放宽全局 `auto_approve` / God-mode（企业策略可放宽确认，但须显式、可审计）  
- ❌ 无 scope / 无审计的「扫任意公网」  
- ❌ Side Panel 作为主终端产品面（企业也应用 Cockpit）  
- ✅ **允许**：企业安装器中的可选 NetSec/Shell/DevSec 模块 + 本地配置

---

## 6. 外部专家原话要点

### Claude（APPROVE_WITH_CHANGES, 82%）

- Scenario Packs 是**承载层**，不是与 DevSec/NetSec 平级的第四支柱。  
- NetSec 工具打包 **永久不做**；页面审计并入 DevSec pack。  
- DevSec **只做 web PRD/附件威胁建模**，不做 white-box SAST 产品。  
- Mini-terminal **SUBSTITUTE**：ghostty-web/xterm.js + companion node-pty；不追官方 WASM。  
- 必须区分终端 UI 与 shell 能力。

### Pi（APPROVE_WITH_CHANGES, 85%）

- DevSec/NetSec 作**产品支柱**会 distract；Scenario Pack 作**打包** 2–3 天级价值。  
- libghostty：**WAIT/NEVER in-extension**；xterm.js substitute 仅 Cockpit L2 工具。  
- 自由 shell = 旁路整条安全栈；v1 必须白名单或结构化工具面。  
- 页面审计用现有 `get_page_html` + Type-A skill 即安全路径。

---

## 7. 最终决策表（含企业勘误）

| ID | 决策 |
|----|------|
| D1 | 产品抽象：**Mission Pack** = skill + knowledge + MCP + tool policy + prompt overlay 的可分发组合 |
| D2 | **全通道首发竖切**：浏览器旁应用安全审查（威胁建模 + 页面/PR 上下文） |
| D3′ | **CWS 默认**：Kill 主动扫描与工具捆绑。**企业本地安装**：NetSec 可为 **opt-in 模块**（scope + 授权 + 审计） |
| D4 | **Kill** 扩展内原生 libghostty（与分发无关的技术边界） |
| D5′ | 终端：企业 SKU 可规划 **Cockpit Shell**（xterm.js/ghostty-web + Companion PTY）；非「网页内嵌 libghostty」 |
| D6′ | 白盒：企业可「安装器可选组件 / 用户自备 CLI / MCP」编排；不自建与 CodeQL 对打的引擎 |
| D7 | Pack **默认只能收窄**权限；企业策略放宽须显式、可审计，禁止静默 God-mode |
| D8 | 开放定制 = 本地 Pack/模块目录 + fork；企业主路径，不另立空洞里程碑 |
| D9 | **双通道分发**：`community`（CWS 友好）vs `enterprise`（本地安装能力模块）— 能力声明与安装器绑定，**不靠 Chrome 商店配置企业能力** |
| D10 | **启用模型**：模块由**用户/管理员自行打开**（opt-in）；安装后**不**自动全开安全能力 |
| D11 | **企业组件优先级**：`AppSec Pack` → `DevSec workspace` → `Shell` → `NetSec` |

---

## 8. 下一步

用户 2026-07-26 已确认 §11。

1. **Design（已写 draft）**：`docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md` — 待 sign-off  
2. Sign-off 后：writing-plans 分阶段实现（顺序见 D11 / design §10）

---

## 9. 证据索引

| 类型 | 路径 |
|------|------|
| Brief | `docs/decisions/v1.3/scenario-packs-libghostty-brief-20260726-190422.md` |
| Claude | `docs/audit/reviews/scenario-packs-claude-20260726-190422.md` |
| Pi (on-topic) | `docs/audit/reviews/scenario-packs-pi-r2-20260726-190647.md` |
| Pi (误跑全库, 忽略本议题) | `docs/audit/reviews/scenario-packs-pi-20260726-190445.md` |
| 技术参考 | ghostty-web (coder)、libghostty 路线、CMspark SkillEngine / L0-L2 redesign |
| 本勘误 | §10（用户：企业内置 + 本地安装配置） |

**综合置信度**：平台层约 **84%**；企业 SKU 下 NetSec/Shell 可做约 **75%**（授权模型与安装器形态仍待你确认细节）。

---

## 10. 勘误：企业本地安装前提（2026-07-26）

### 10.1 用户澄清

> 这些能力属于**企业内置能力**，由用户**本地安装/自行配置**开启，**不是**从 Chrome 商店配置/分发。

（解读：「自动配置」按「**自行**配置 / 本机配置」理解；若本意是「零配置自动启用」，见 §10.5。）

### 10.2 对前一轮结论的冲击

| 前一轮论据 | 企业本地安装后 |
|------------|----------------|
| CWS dual-use → 禁捆绑 nmap | **弱化**：企业工具在 Companion 安装包/可选组件里，**不**作为 CWS 扩展声明能力 |
| 「永远不做 NetSec」 | **改为**：CWS 永远不做；企业模块可做 |
| 终端 P2 才考虑 | **改为**：企业路线可与安全模块同批；仍须 PTY 在 Companion |
| Mission Pack 组合层 | **不变**，且更适合企业：本地 `packs/` + 安装器勾选模块 |
| 扩展内 libghostty 原生 | **不变：仍不可行** |

### 10.3 推荐架构（企业）

```
本地安装器 (dmg/pkg/msi 或现有 companion 安装流)
├── Companion（核心，始终安装）
│   ├── Mission Packs 目录（~/.cmspark-agent/packs/）
│   ├── optional: capability-netsec/   # 工具适配 + 策略
│   ├── optional: capability-shell/    # node-pty + 审计
│   └── optional: tool binaries or PATH 探测（semgrep/nmap…）
├── Chrome Extension（侧载 / 企业强制安装 / 开发者模式）
│   └── UI only：Pack 开关、Cockpit、确认流 — 不承载扫描二进制
└── 配置
    ├── capability_profile: enterprise
    ├── enabled_modules: [appsec, netsec?, shell?]
    ├── netsec.target_allowlist: [...]
    └── shell.policy: confirm | allowlist | audit
```

**原则：危险能力装在 Companion，扩展只做控制面。** 与现有「LLM/工具在 Companion」拓扑一致。

### 10.4 企业 NetSec / Shell 的最低安全合同（替代「商店红线」）

1. **安装时显式勾选**模块（默认不装 NetSec/Shell）。  
2. **目标 scope**：CIDR / 域名 /「仅 localhost」/ 企业资产清单；出站扫描出 allowlist 硬拒。  
3. **任务级授权文案**（「我确认对下列资产拥有测试授权」）写入 history。  
4. **审计日志**：谁、何时、对何目标、何工具、结果摘要。  
5. **与现有确认栈统一**：高危不可被 domain whitelist 误放行；企业「降低确认摩擦」用独立 policy，不复用 cookie 信任域。  
6. **Shell**：session 绑定 thread；结束 kill PTY；禁止静默 `auto_approve_dangerous` 作为默认。

### 10.5 已确认：自行打开模块（A）

用户确认选 **A**：安装后由**用户/管理员自行打开**模块；**不**装完即全开。见 §11。

---

## 11. 用户确认锁定（2026-07-26）

| # | 问题 | 用户决定 | 落入决策 |
|---|------|----------|----------|
| 1 | 模块启用方式 | **用户/管理员自行打开**（opt-in，默认最小权限） | **D10** |
| 2 | 企业组件优先级 | **符合**建议顺序 | **D11** |

### D11 实施顺序（锁定）

```
P0  AppSec Pack（威胁建模 + 页面审计 + Pack 平台）
P1  DevSec workspace（workspace_root + 本机/可选 CLI 编排）
P1′ Shell 模块（Cockpit + Companion PTY + 策略/审计）
P2  NetSec 模块（scope allowlist + 授权声明 + 审计；可选工具）
```

### 默认安全姿态（与 D10 一致）

- 新装 / 升级：`enabled_modules = []` 或仅含非高危的 AppSec 只读 Pack（若产品选择「建议启用」也须**一次显式确认**，不得静默）。  
- NetSec / Shell：**禁止**默认 enabled。  
- 管理员策略可预置「允许启用」名单，仍不能代替终端用户对具体高危任务的授权文案（NetSec scope 任务级确认保留）。

**状态**：产品方向决策闭环；下一动作是 design spec 或实现 plan，无需再开一轮外审 unless 规格细节分叉。
