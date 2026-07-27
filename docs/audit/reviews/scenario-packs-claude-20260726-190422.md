# CMspark 产品+安全评审（外部视角，对抗式）

**评审对象**：Scenario Packs + Mini Terminal (libghostty) 提案  
**评审日期**：2026-07-26  
**评审立场**：外部产品+安全专家，对抗式

---

## 总览判断（先说结论）

提案把 **四个性质完全不同的东西** 捆成一批：
1. 一个**纯打包层**（Scenario Packs）——低成本高杠杆，但提案没认清它已经是 runtime primitive
2. 一个**身份错位**（DevSec）——有能力做，但定义不清就会 drift 成 SAST
3. 一个**政策雷区**（NetSec + bundled tools）——Chrome Web Store dual-use policy 直接命中
4. 一个**技术概念混淆**（libghostty mini terminal）——把"终端 UI"和"任意 shell 能力"混淆了

四个不能一起 APPROVE。下面逐项展开。

---

## Q1 — 战略契合度：深化还是分心？

**判定：30% 深化 / 70% 分心（按当前写法）**

CMspark 的护城河定义是 **browser-native agent**（不是 IDE，不是渗透平台）。逐项对照：

| 支柱 | 与定位契合度 | 风险 |
|---|---|---|
| DevSec（PRD 威胁建模） | ✅ 高 —— 浏览器里看 web PRD/附件，自然延伸 | 范围 creep 到 SAST/white-box code audit |
| DevSec（white-box 代码审计） | ❌ 低 —— 这是 IDE/SAST 平台的活 | 直接竞争 CodeQL/Snyk/Semgrep，且 companion 不是 code analysis runtime |
| NetSec（页面源审计） | ✅ 高 —— 已有 `get_page_html`/`evaluate` | 无 |
| NetSec（端口扫描/工具打包） | ❌❌ 极低 —— 这是 pen-test 平台的活 | Chrome Web Store 政策 + 法律责任 |
| Custom packs | ✅✅ 最高 —— 纯放大现有原语 | 无 |
| Mini terminal | ⚠️ 中 —— Cockpit 内合理，定位模糊则危险 | 把"UI 组件"误解为"任意 shell 能力" |

**核心警告**：DevSec + NetSec 两支柱的 **现定义版本**，本质上是想往 SAST 和 pen-test 平台扩张。这违反 ADR-007 既定的 positioning。要让它们 fit，必须 **把范围砍到浏览器上下文**（PRD 威胁建模、页面源审计），而不是去打包 nmap 或竞争 CodeQL。

---

## Q2 — 四支柱排序：DevSec / NetSec / Custom packs / Mini-terminal

### 推荐出货顺序（或砍）

| 优先级 | 支柱 | 动作 | 理由 |
|---|---|---|---|
| **P0** | Custom packs (Scenario Pack SDK) | **SHIP FIRST** | 是其他三个的承载层；不做这个，DevSec/NetSec 永远是硬编码 |
| **P1** | DevSec（仅 PRD 威胁建模版） | **PIVOT then ship** | 砍掉 white-box code audit，专注 web PRD/附件威胁建模 + 链接代码分支；契合定位 |
| **P2** | Mini-terminal | **SUBSTITUTE** | 用 ghostty-web 或 xterm.js + companion `node-pty`；不追 libghostty WASM |
| **P3 / KILL** | NetSec（bundle 工具版） | **KILL** | 商店政策 + 法律 + 产品 drift 三重雷区 |
| **P3 / RESCUE** | NetSec（页面源审计版） | **MERGE 进 DevSec** | 已有 `get_page_html`/`evaluate`，做成一个 skill pack 即可，不配独立支柱 |

**关键洞察**：所谓"四支柱"，真正独立存在的只有 **Scenario Packs** 一个。DevSec/NetSec 都是 pack 的实例，Mini-terminal 是 Cockpit 内的功能模块。提案的层级分类是混乱的。

---

## Q3 — libghostty：建 / 等 / 替代 / 不做

**判定：SUBSTITUTE（替代）—— 用 ghostty-web 或 xterm.js + companion `node-pty`**

### 提案的核心概念错误

> 提案说"libghostty mini terminal in extension/web UI for precise/extensible ops"

这句话**混淆了两件事**：
- **终端模拟器 UI**（VT parser + 渲染）—— 是个前端组件
- **任意 shell 能力**（执行命令、pipe、退出码）—— 是后端 capability

光有 UI **不是产品**。ghostty-web 的 demo 已经证明：UI 必须配真实的本地 shell over WebSocket 才有意义。所以真正的问题不是"用哪个 VT parser"，而是"shell 跑在哪、谁能调它"。

### 四个选项的真实账本

| 选项 | 可行性 | 成本 | 风险 |
|---|---|---|---|
| **Build**（自己集成 libghostty 原生） | ❌ MV3 extension 不能 link native lib | 极高 | 不可能 |
| **Wait**（等 libghostty 官方 WASM） | ⚠️ 官方说 planned 但非优先 | 不可知的时间 | 等待成本高 |
| **Substitute**（ghostty-web 或 xterm.js + companion node-pty） | ✅ 现成方案，今日可上 | 低 | 已知风险可控 |
| **Never in-extension** | ✅ 作为兜底 | 零 | 失去 Cockpit 自动化场景 |

### 我的推荐

**用 ghostty-web（如果想要更现代的渲染 + MIT 友好）或 xterm.js（如果想要生态成熟 + 文档多）**，配上 companion 端的 `node-pty`。理由：

1. ghostty-web 已经 xterm.js API 兼容，未来切换成本低
2. companion 已经是 Node.js + TypeScript，加 node-pty 是天然的事
3. MV3 CSP 不影响 companion，shell 执行不在沙箱里
4. 把它叫 **"Cockpit Shell"**，明确范围是**本机操作**（computer use 上下文），不是"嵌入终端"模糊概念

**不要追 libghostty WASM**——它会来，但你的产品等不起。

---

## Q4 — NetSec 红线（安全 + 商店政策）

这条最严重，单独展开。

### Chrome Web Store 政策硬红线

Chrome Web Store 的 [Acceptable Use Policy](https://developer.chrome.com/docs/webstore/program-policies) 明确禁止：
> *"Tools that are primarily designed to ... enable unauthorized access to systems, networks, or resources"*

打包 nmap/masscan/sqlmap/nikto 类工具**直接命中**。哪怕合规解释得通，审核会被 flag，下架风险随举报累积。

### 法律责任红线

"common port scans" + "bundle popular network security tools" 在很多司法辖区：
- 扫描未授权第三方 IP/域名 = 计算机犯罪法（CFAA / 中国《刑法》285 条）
- 即使用户点同意，平台也可能承担**促成（facilitation）**责任

### 我设的硬红线（如果 NetSec 要活下去，必须满足）

1. **绝不打包** offensive 工具（nmap/masscan/sqlmap/nikto/hydra/metasploit 等）——任何打包都过不了我的 review
2. **扫描范围限定 localhost + 用户自有内网**（需用户勾选"我拥有该目标"）
3. **页面源审计**保留——这是浏览器上下文内能力，已有 `get_page_html`/`evaluate`
4. **IP/URL 分析**走"被动情报"（whois、cert transparency、DNS 历史），不做主动探测
5. **不做 PoC exploit 生成**——这是 Metasploit 模式的红线

按这五条，**现写的 NetSec 支柱已经死了**。能活下来的只有"页面源审计"和"被动情报查询"，这些应该并入 DevSec pack，不配做独立支柱。

---

## Q5 — 最小 P0（用现有原语交付 80% 用户价值）

### P0 范围（推荐 4 周内出货）

**P0.1 — Scenario Pack SDK（最高优先）**

把现有原语**正式化**为一个 pack 格式：

```yaml
# pack.yaml
name: web-prd-threat-modeler
version: 0.1.0
composition:
  skills: [threat-modeling/stride, threat-modeling/dread]
  knowledge: 
    - domain: general/owasp-2025
    - site: https://your-org/confluence/security-wiki
  mcp_servers: [github-mcp]
  tool_whitelist: [get_page_html, evaluate, navigate, list_tabs]
  thread_template: threads/web-prd-review.md
capabilities:
  requires_confirmation_for: [evaluate, navigate]
  prohibits: [osascript_eval, set_cookie]
```

这个 SDK **不需要任何新 runtime**——已有 skill-engine + knowledge + MCP client + tool_whitelist + thread-manager 全部到位。纯打包+验证器+文档。

**P0.2 — 三个官方 pack（验证 SDK）**

1. **Web PRD Threat Modeler**：上传 PRD（PDF/MD/URL）→ STRIDE 分析 → 输出威胁清单 + 验收测试建议。**只看 PRD，不做代码 SAST**
2. **Personal Browsing Assistant**：知识 = 用户 bookmark + history；skill = 信息整理/对比；tool = get_page_html/navigate
3. **Internal Docs Q&A**：知识 = 公司 wiki 导入；skill = RAG-based Q&A

**P0.3 — Pack 管理器 UI**

side panel 增加 "Packs" tab：列出已安装 pack，每个 pack 是一个"专题模式"入口（预设 system prompt + skills + 知识库 + 工具白名单）。

### P0 不包含

- ❌ Mini-terminal（推 P1）
- ❌ NetSec bundle（永久不做）
- ❌ White-box code SAST（永久不做，留给 CodeQL/Snyk）
- ❌ libghostty 集成（永久不做）

### 为什么这套能拿 80% 价值

- 用户痛点不是"没有终端"或"没有 nmap"——是"我有一个具体场景，想给 agent 装备对应的技能+知识+工具"
- 这个痛点 100% 由 pack 形式解决
- DevSec 的 80% 价值（PRD 威胁建模）通过 P0.2 的 pack #1 交付
- NetSec 的 80% 价值（页面源审计）通过现有 evaluate + 一个 pack 的 skill 解决

---

## Q6 — 最终建议

# **APPROVE_WITH_CHANGES**

理由：核心想法（用 pack 形式封装场景）是对的，但**四个支柱的层级、范围、技术选型都需要重新定义**。不能照当前写法 ship。

### 必改项（7 条）

1. **重新分级**：Scenario Packs 不是支柱之一，是**所有场景的承载层**。DevSec/NetSec/Custom 都是 pack 的实例，不是平级概念。Mini-terminal 是 Cockpit 内的功能模块。把提案结构改成"1 平台 + 1 模块"。

2. **KILL NetSec 的工具打包部分**：nmap/masscan/sqlmap 等的 bundle 永久不做。商店政策 + 法律责任双重不可接受。能活下来的"页面源审计"和"被动情报查询"并入 DevSec pack。

3. **DevSec 范围砍半**：明确**只做 web PRD/附件的威胁建模**（STRIDE/DREAD），不做 white-box 代码 SAST。代码 SAST 留给 CodeQL/Snyk/Semgrep。CMspark 不进 IDE 战场。

4. **Mini-terminal SUBSTITUTE**：用 ghostty-web 或 xterm.js + companion `node-pty`。**不追 libghostty WASM**。改名"Cockpit Shell"，范围限定本机操作（与 computer use 的 4 档确认机制一致）。

5. **P0 = Pack SDK + 3 个官方 pack**：明确 4 周内出货范围。Mini-terminal 推 P1，DevSec pack 通过 P0.2 #1 验证 SDK。

6. **混淆"终端 UI"和"shell 能力"**：提案和文档里必须永远区分两者。libghostty/ghostty-web/xterm.js 都是 UI；shell 能力来自 companion 端的 pty。**没有 companion node-pty，任何终端 UI 都是空壳**。

7. **安全门**：所有 pack 在 SDK 层强制声明 `prohibits` 列表；NetSec 相关 pack 强制 `prohibits: [osascript_eval, evaluate(untrusted)]` 并需用户手动启用电诈模式。Pack 市场如开放，每个上架 pack 走一次 review（自动 + 人工）。

### 同意保留的部分

- ✅ Scenario Packs 的核心想法
- ✅ DevSec 做威胁建模（仅 PRD 范围）
- ✅ Mini-terminal 在 Cockpit 内的合理性（前提是 substitute libghostty）
- ✅ 页面源审计（并入 DevSec pack）
- ✅ 开放用户自定义（pack SDK 自然支持）

---

## Q7 — 置信度

**82%**

### 高置信部分（>90%）
- NetSec 工具打包是政策雷区
- libghostty 不能进 MV3 extension
- Scenario Packs 是正确的 abstraction
- Mini-terminal UI ≠ shell 能力

### 中置信部分（70-85%）
- DevSec 应该砍到 PRD 范围（可能错失 white-box 价值，但定位更安全）
- ghostty-web 优于 xterm.js（生态差距现实存在，文档/插件 xterm.js 更成熟）

### 低置信部分（<70%）
- 用户是否真的会安装第三方 pack（vs 官方内置）—— 需要用户研究
- Pack 是否需要 marketplace（vs 仅本地导入）—— 看采用率
- DevSec vs NetSec vs Custom 的真实用户需求排序 —— 我基于直觉和定位判断，没看用户访谈数据

---

## 附录：提案里需要当场纠正的话术

| 提案原文 | 问题 | 应改为 |
|---|---|---|
| "libghostty mini terminal in extension/web UI" | MV3 不能 link native；且 UI ≠ 能力 | "Cockpit Shell via ghostty-web/xterm.js + companion node-pty" |
| "bundle popular network security tools" | 商店政策违反 | 删除 |
| "common port scans" | 法律风险 | "localhost-only diagnostics" 或删除 |
| "white-box knowledge packs + external code-audit assets" | drift 进 SAST | "PRD/attachment threat-modeling packs (no source SAST)" |
| "DevSec / NetSec / Custom / Mini-terminal 四支柱" | 层级混乱 | "Scenario Packs (platform) + Cockpit Shell (module)" |

---

**评审完毕。建议下一步**：把这份评审发给 Grok + Pi 做三方共识（按 [[multi_agent_advisor_pattern]] 既定流程），特别是 Q4 红线和 Q6 必改项 #2（NetSec kill）需要外部验证我的判断。
