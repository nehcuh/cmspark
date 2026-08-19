# file: 导航：从 Layer 1 硬拦拆成路径笼子 + L2 确认

**日期**: 2026-08-19  
**状态**: **LOCKED**（2026-08-19 三路对抗合成：A REJECT / B REJECT / C APPROVE_WITH_NITS → 吸收 P0/P1 后实现）  
**合成**: `docs/audit/reviews/file-scheme-l2-adversary-synthesis-20260819.md`  
**Blast tier**: **T3**（Trust / URL gate / confirm 绑定）  
**触发**: 对话 `2mg8oq` — Agent 用 `create_tab(file:///…pdf)` 看下载目录发票，Layer 1 1ms 硬拦；用户误以为批准弹窗会写入 MCP allow-dir。

**前序**:

- [ADR-006](../../adr/006-layered-defense.md) L1/L2
- [ADR-007](../../adr/007-domain-whitelist-auto-approve.md) `auto_approved_domains`
- [ADR-010](../../adr/010-tiered-privilege-godmode.md) God-mode；**显式 non-goal「非 http(s) 不做细粒度白名单」本轮要修订，不是绕过**
- MCP allow-dir 笼子：`companion/src/mcp/allow-dir-expand.ts`
- 现场证据：`~/.cmspark-agent/logs/companion-2026-08-19.log` `security.url_scheme_blocked` scheme=`file:` thread=`2mg8oq`

---

## 0. 能力声明（ADR-020）

```text
Surface:      L1 浏览器导航（create_tab / navigate / set_tab_url）
L2-classes:   URL 确认门 — 仅 file: 从硬拦改为路径笼子 + HITL；
              javascript: / data: / chrome: / about: / blob: 仍 L1
Compose:      不改 MCP filesystem；不把浏览器打开写入 MCP allow-dir
Autonomy:     无人值守 auto_approve_dangerous 不得因此获得 file: 打开权
Trust:        单调：放宽 scheme 桶必须配更严的路径门 + 空 relevantDomains
Channel:      community | enterprise 相同（不引入企业-only 开关）
```

**禁止**: 引导用户开协议解锁来看 PDF。God-mode 仍可绕过（既有），不是本功能的产品出口。

---

## 1. 问题与用户可观察 DoD

| # | 用户可观察 | 今日 | 本轮后 |
|---|------------|------|--------|
| D1 | 在对话里请 Agent 用浏览器打开 `~/Downloads/*.pdf` | `Security Block: create_tab to file: scheme is not allowed` + 误导「若你已拒绝弹窗」 | 弹出确认，文案含**解码后的本地路径**；批准后 `create_tab` 下发扩展 |
| D2 | Agent 被注入去开 `file:///etc/passwd` 或 `~/.ssh/id_rsa` | 同 D1 硬拦（scheme） | **仍硬拦**，原因是路径笼子，**不弹窗** |
| D3 | `javascript:` / `data:` / `chrome://` | L1 硬拦 | **不变** |
| D4 | 点确认「加白名单」 | 不适用（从未弹窗） | **不出现**域白名单选项；即使 WS 伪造 `add_to_whitelist` 也不得写入 `auto_approved_domains` |
| D5 | `auto_approve_dangerous` 开着，Agent `create_tab(file:…)` | L1 仍拦 | **仍须确认**（或笼子硬拦）。只有 `allow_all_schemes` 可跳过 file: L2 |
| D6 | 硬拦文案 | 套用「若你已拒绝弹窗」 | scheme 硬拦 / 路径笼子硬拦 **不得**提弹窗 |

**非目标（v1）**:

- 不申请扩展 `file:///*`、不引导「允许访问文件网址」
- 不把 PDF 解析进 LLM（那是 MCP / 上传 `parseFile`）
- 不新增 `open_local_file` 工具
- 不改 evaluate / get_page_html 的既有 L2（file: tab 上脚本注入仍受扩展 + evaluate 门）

---

## 2. 门代数（锁）

现有 `runUrlNavigateAdmission`（`companion/src/tool/url-cookie-admission.ts`）:

```
if protocol ∉ {http:, https:} then
  if !allow_all_schemes → HARD_BLOCK scheme
  else fall through
skipL2 = auto_approved_domains || auto_approve_dangerous || allow_all_schemes
```

本轮改为：

```
if protocol ∈ {javascript:, data:, chrome:, about:, blob:, …非 file:} then
  if !allow_all_schemes → HARD_BLOCK scheme     # 不变
else if protocol === "file:" then
  if allow_all_schemes → 既有 god-mode 旁路 + 审计
  else
    path = decode file URL → 本地绝对路径（失败则 HARD_BLOCK invalid）
    if UNC / 非空 hostname∉{ "", "localhost" } → HARD_BLOCK cage
    if !fileUrlPathOfferable(path) → HARD_BLOCK cage   # 不弹窗
    else REQUEST L2（relevantDomains = []）
         skip 仅当 allow_all_schemes
         # 不读 auto_approve_dangerous / auto_approved_domains
else
  既有 http(s) L2 / 域白名单
```

### 2.1 为什么 auto_approve_dangerous 不能跳过 file: L2

今日 L1 的安全承诺：**无人值守开关不打开本地文件**。若 file: 降到普通 URL L2，`skipUrlConfirmation` 已含 `auto_approve_dangerous`，无人值守会静默 `create_tab(file:///Users/…/.ssh/…)`——笼子会拦 `.ssh`，但仍会静默打开任意 home 内 PDF/文档。那是 **L1→L2 的静默放宽**，本轮禁止。

三旗全自动巡航（`isFullAutonomyCruise`）**可以**跳过 file: L2（与 MCP 写确认一致：用户已选最大残余风险）。单独 God-mode（`allow_all_schemes`）也跳过（既有 ADR-010）。两者都打审计。

### 2.2 路径笼子（复用，不新造敏感名单）

从 `allow-dir-expand.ts` **import**（禁止复制一份）：

- `isVolumeOrFsRoot`
- `isMultiUserProfilesRoot`
- `isSensitiveSystemDir`
- `SENSITIVE_PATH_SEGMENTS` / 凭据分量（`.ssh` `.gnupg` `.aws` `.kube` `keychains`）
- `pathToFileUri` 的逆：file URL → 路径（已有 `extractPathCandidate` 片段，抽纯函数更好测）

额外（浏览器 file: 特有，MCP 没有）：

- `file://server/share/...`（hostname 非空且不是 localhost）→ 硬拒绝（UNC / 远程 file）
- 解码失败、空 path、非绝对路径 → 硬拒绝
- **realpath** 后再判笼子（防 symlink 逃到 `/etc`）
- 目标不存在：仍可 L2（用户可能刚下载完）。realpath 失败则对 **resolve 后的绝对路径** 做笼子（敏感前缀 fail closed；禁止未规范化 `../`）
- **v1 仅 home 内**（对抗 A7）：realpath/`resolve` 后必须 `!path.relative(home).startsWith("..")`

**不**要求路径已在 MCP allow-dir 内。浏览器打开 ≠ filesystem 读；两套名单保持正交。  
**禁止**复用 `extractPathCandidate` / `resolveAllowDirToOffer`（对抗 A5/C-01：localhost file URL 会被解析成相对路径；cruise 会摘掉 `.ssh` 段）。

### 2.3 确认对话框

| 字段 | 值 |
|------|-----|
| `toolName` | 原工具名（`create_tab` / `navigate` / `set_tab_url`） |
| `code` | `open_local_file(<decoded absolute path>)` — 人读路径，不是 raw `file://` percent-encoding |
| `relevantDomains` | **`[]`** — 隐藏「加到域白名单」 |
| `dangerousApis` | `["file-open"]` 或 `["local-file"]`（给 UI 风险标签，不进白名单逻辑） |
| `riskLevel` | `medium` |
| `autoConfirmEligible` | `false` |

批准 = 这一次打开。**不**持久化路径白名单（v1 YAGNI；避免第二套 allow-dir）。每次 `file:` 都问。

### 2.4 文案

`formatChatErrorLine` 今日凡 `errorLevel==="security"` 都追加「若你已拒绝弹窗…」。必须分流：

| 错误类 | 机器 token（classifyError 仍能匹配 Security Block） | 用户句 |
|--------|------------------------------------------------------|--------|
| scheme L1 | 保留 `Security Block: … scheme is not allowed` | **不是弹窗**。说明仅 http/https；看本地文件请用确认后的 file: 路径或 filesystem MCP |
| path cage | `Security Block: ${tool} to local path is not allowed (sensitive/system/unc)` | **不是弹窗**。说明该路径不能用浏览器打开 |
| file: L2 拒绝/超时 | 既有 `was denied by user` / timeout | 可以提弹窗 |

Side Panel `gate-error-copy.ts` **lock-step** 同样短语。

---

## 3. ADR-010 修订（本轮必须写）

修订 non-goal：

> ~~❌ 非 http(s) 协议开 per-domain allowlist（God-mode 是全局开关，不做细粒度）。~~
>
> **2026-08-19**：`file:` **不是** per-domain allowlist。`file:` 从 L1 硬拦改为 **路径笼子 + 每次 L2**；`javascript:` / `data:` / `chrome:` / `about:` / `blob:` 仍 L1。God-mode 仍是唯一「所有 scheme 都放行」的全局开关。`auto_approved_domains` **继续只表示 http(s) 主机**。

God-mode 风险段里「读 file: 本地文件」改为：未开 God-mode 时 file: 走 L2+笼子；开了则仍绕过（审计 `godmode_bypassed`）。

---

## 4. 测试合同（机核 DoD）

改 `companion/tests/url-cookie-admission.test.ts` 现有  
`hard-blocks non-http(s) schemes`：fixture 从 `file:///etc/passwd` **改为** `javascript:alert(1)` 或 `chrome://settings`（否则会测错门）。

新增：

1. `file:///etc/passwd` → ok:false，**confirm 未被调用**，error 匹配 cage 而非 scheme
2. `file://…/.ssh/id_rsa`（home 下凭据段）→ cage，无 confirm
3. `file:///Users/<home>/Downloads/a.pdf`（测里用 `os.homedir()` 拼）→ confirm 被调用；deny → 失败
4. 同上 approve → ok:true；`request` 的 details.`relevantDomains` 为 `[]`
5. `auto_approve_dangerous=true` 仍对 (3) **调用 confirm**（不静默放行）
6. `allow_all_schemes=true` 对 (3) **不**调用 confirm（god-mode）
7. `javascript:` / `data:` / `chrome:` 仍 scheme 硬拦（confirm 不被调用）
8. `file://nas/share/x.pdf`（UNC）→ cage，无 confirm
9. 集成：`security-gates.test.ts` item 12 `navigate to file://` 改为断言 cage 文案；另留一条 scheme 硬拦（chrome/data）

文案单测：`user-gate-copy` / extension `gate-error-copy` 对 scheme 硬拦字符串 **不含**「拒绝弹窗」。

---

## 5. 实现落点（建议最小 diff）

| 文件 | 变更 |
|------|------|
| `companion/src/tool/url-cookie-admission.ts` | 拆 scheme；file: 分支 |
| `companion/src/mcp/allow-dir-expand.ts` 或新 `tool/file-url-admission.ts` | 纯函数 `parseLocalFileUrl` + `assertFileUrlOfferable`，admission 调用 |
| `companion/src/capability/user-gate-copy.ts` | 分流文案 |
| `chrome-extension/src/sidepanel/utils/gate-error-copy.ts` | lock-step |
| `docs/adr/010-tiered-privilege-godmode.md` | 修订 non-goal |
| 测试如上 | |

**不改**: `browser-bridge.createTab`（扩展仍 `chrome.tabs.create`；Chrome 拒 file: 作为既有 tool error 上浮）。v1 不申请 `file:///*`。

---

## 6. 残余风险（诚实）

1. **扩展可能打不开 file:** — 无「允许访问文件网址」时 `tabs.create(file:)` 可能失败。用户看到确认通过 + 工具错误，而不是 scheme 硬拦。可接受；错误应是 Chrome/扩展层，不再假装是「你拒绝了弹窗」。
2. **每次都问** — 无路径白名单。看十张发票点十次。换确认疲劳 vs 第二套持久名单；v1 选疲劳。
3. **home 内任意非敏感文件** 经一次点击可在浏览器打开。MCP 默认 allow=home 已经能读这些文件；本轮不扩大磁盘读面，只增加「给人看」通道。
4. **evaluate on file: tab** — 未新硬拦。无 file access 时注入会失败；有 file access + evaluate L2 通过则能在本地页跑脚本。视为既有 God-mode / 扩展权限问题，不在 v1 加第三道。

---

## 7. 多路对抗车道（本 strawman 的阅卷机）

| Lane | 透镜 | 必问 |
|------|------|------|
| **A Security/Trust** | 注入 → file: 打开；L1 降级是否被 auto_approve 吞掉；白名单注入；symlink；UNC | 能否 APPROVE 代数 §2？漏了哪条笼子？ |
| **B Product/UX** | 发票 PDF JTBD；文案；确认疲劳；与 MCP 名单混淆 | 用户还可能把这次批准理解成什么？ |
| **C Chrome/Correctness** | `tabs.create(file:)`；Windows 盘符；pathname 解码；item 12 测试迁移 | 实现会在哪条 URL 解析上翻车？ |

每路独立、只读、产出 findings 表 + `VERDICT: APPROVE \| APPROVE_WITH_NITS \| REJECT`。合成后再写实现。实现 agent 不得自评放行。
