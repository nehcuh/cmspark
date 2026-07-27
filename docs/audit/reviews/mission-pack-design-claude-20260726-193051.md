# 设计评审：Mission Pack + Enterprise Capability Modules

读完。整体方向稳，平台层（Pack 组合）和企业分通道姿态都站得住。但有几处**实现前必须收紧**的安全/语义模糊点，否则会留 bug。

---

## 1. 与锁定决策的一致性核查

| 锁定项 | 设计体现 | 备注 |
|---|---|---|
| Mission Pack 非新 runtime | S1 明确 `apply`=写 Thread 字段 | ✅ |
| 双通道 | §3.2 community/enterprise + `capability_profile` | ✅ |
| opt-in（D10） | §7.1 modules 默认 `enabled: false` | ✅ |
| 建设顺序（D11） | §10 P0→P1→P1′→P2 | ✅ |
| 不进扩展内 libghostty | §7.3 Shell=Companion PTY + Cockpit | ✅ |
| NetSec allowlist + task auth + audit | §7.3 D + §8.2 | ✅ 框架在，但**算法未定义**（见下） |

**结论**：方向与锁定的产品决策无冲突。

---

## 2. 阻塞项（must-fix before implementation）

### M1. `tools.mode: intersect` 在 null whitelist 下的**实际语义**与文档不符

§6.4 写："若原 whitelist 为 null，先视为「全工具」再与 allow 交"。

**问题**：现有 `tool_whitelist === null` 表示「全开」，但**没有一份显式的「全工具清单」可拿来求交**。如果实现层用 `null ∩ allow = allow` 这种捷径，`intersect` 就退化成 `allowlist`；如果用「构建时枚举所有工具 ID」则容易在新增工具时漏权限。

**要求**：spec 显式定义：
- `intersect` 的「全工具集合」从哪个权威源来（建议：`tool-definitions.ts` 的注册表 snapshot，**禁止**靠 LLM 实际能调用的集合推断）
- 单测必须包含：新增一个工具到 registry 后，已有 `intersect` pack 不会自动获得该工具

### M2. `system_prompt_append` 必须落 `ALLOWED_CONFIG_OVERRIDE_KEYS`，否则 §6.5 走不通

设计已经在 §6.5 给出推荐。**确认这是 P0 阻塞**：若不改 `ALLOWED_CONFIG_OVERRIDE_KEYS`，要么 pack prompt 整段覆盖用户自定义（破坏性），要么被 validator 拒（pack 失效）。

**要求**：在 §10 P0 表格里把"扩 `ALLOWED_CONFIG_OVERRIDE_KEYS` 增加 `system_prompt_append`"显式列为交付项，而不是"实现细节"。

### M3. Shell 的 per-session 确认不构成"高危 host"合同

§7.3 C 写 `policy: confirm` = "每个启动 session 确认；可选 per-command"。**这不够**：用户一旦放行 session，LLM 可在 PTY 内执行任意命令流（包括 `rm -rf`、外发数据），与 `osascript_eval` 每次确认的强度**不等价**。

**要求**：
- 默认 `policy: confirm` 必须是**每命令确认**，session 级确认只能作为"严格模式"的反向（即用户主动选择"放宽为 session 级"）
- 或明写威胁模型："Shell session 一旦开启等价于 host shell，用户责任边界在 session 启动那一刻"——但这与 §8.3 "Shell 旁路确认 → module 门 + policy + 审计" 的强姿态矛盾
- 还需覆盖 **TIOCSTI / PTY 注入**：恶意被启程序可通过 TIOCSTI 回灌命令到 shell；spec 要规定 PTY 的 isolation 模型（建议：禁 TIOCSTI、单 session 单 foreground process group、kill PGID）

### M4. NetSec `target_allowlist` 匹配算法未定义

§7.3 D 给了"`*.corp.example`、CIDR"，但没说：
- `*.corp.example` 是否匹配 `corp.example` 本身（dnspython 风格不匹配，pyftpdlib 风格匹配）
- 是否匹配 `a.b.corp.example`（多级）
- CIDR 是否含 IPv6（建议 P2 仅 IPv4 + 拒 IPv6 直连）
- host:port / CIDR + port 是否单独 scope（建议**不**支持端口 scope，netsec 全端口）
- IDN / punycode 处理

**要求**：§7.3 D 加一段「匹配算法规范」+ 单测覆盖。否则出现"`*.corp.example` 应该被允许却拒绝了"这类扯皮。

### M5. Pack apply 非原子，半失败状态会污染 Thread

§6.4 apply 顺序写多个 Thread 字段（`active_skill_ids` / `tool_whitelist` / `system_prompt_append` / `mission_pack_id` / `workspace_root` …）。若在第 N 个字段写完后失败，Thread 处于"半 pack 化"状态，用户回不去也前进不了。

**要求**：apply 必须是 **prepare-then-commit**：
1. 阶段 1：跑 validator + 收集所有要写的字段到内存对象
2. 阶段 2：一次性写 Thread（thread-manager 加 `applyPackDelta` 方法，内部一次 mutation）
3. 失败回滚到上一个 snapshot（或最少：apply 失败时 Thread 状态不变）

### M6. Pack uninstall 后 Thread 字段清理策略缺失

§6.6 说"已 apply 的 thread 保留 id 引用，运行时 skill 缺失则降级提示"。**但没说 `tool_whitelist` 怎么办**。

场景：pack 应用时 `tool_whitelist = [list_tabs, navigate]`（来自 pack.allow）；用户卸载 pack 后，whitelist 仍是窄列表，Thread 永久残废。

**要求**：spec 明确三选一并单测：
- (a) 卸载 pack 时扫描所有 apply 过的 thread，把 whitelist 重置为 null（破坏性，但干净）
- (b) pack.apply 时记录"pack 前的 whitelist snapshot"到 thread，卸载时回滚
- (c) uninstall 拒绝执行若仍有 thread 引用，先要求用户手动清理

推荐 (b)。

### M7. 审计日志文件属性 + 写入语义未规定

§8.2 只说 `append-only`。**最小合同缺失**：
- 文件权限 `0o600`，目录 `0o700`，owner = 当前用户
- 写入用 `O_APPEND`（多进程/重开后仍 append-safe）
- **禁止**任何 companion 代码路径 `truncate` / `unlink` 该文件
- rotation：P0 不做，但禁止写超过单行 256KB（防 pack 把整个 prompt 当 audit 字段塞进去炸盘）

### M8. Pack zip slip 防护未在 install 路径写明

§11 testing 提到"pack zip slip"，但 §6.3 `pack.install` 没规定 install 流程的**写入前**路径校验。

**要求**：spec §6.3 install 流程：
1. 解压到 tmp 目录
2. 校验**每条 entry** 的目标路径在 tmp 下（realpath containment，**对每条 entry**，不只对最终路径）
3. 校验 pack.yaml 的相对路径 skills/knowledge 在 pack 根下
4. 通过后 rename 到 `packs/installed/<id>`

Obsidian 导出已有 `resolveTemplatesDir` 的 realpath containment 可以复用模式，但**不是同一段代码**（pack install 多了 zip 解压层）。

---

## 3. 非阻塞但应明确（nits）

### N1. `pack.id` 正则未保留 CLI 保留字
`^[a-z0-9][a-z0-9-]{1,63}$` 不会拦 `--help`、`-v`，但建议额外拒 `^(--|-)` 前缀，防止未来 CLI 误解析。

### N2. Secondary skill root 命名冲突
§6.6 推荐 secondary root = pack 目录。**没说 dedup 策略**：用户已有 `skills/threat-model-stride.md`，pack 也叫同名，谁优先？

建议：pack skill 在 skill-engine 内**强制加前缀** `pack/<pack_id>/<skill_name>`，`active_skill_ids` 也用全名；用户全局 skill 命名空间不污染。

### N3. `mission_pack_id` 在 Thread 迁移
现有 thread 没这个字段。`thread-manager.ts` 反序列化时默认 `mission_pack_id: null`、`workspace_root: undefined`、`netsec_scope_snapshot: undefined`。spec 应明写"老 thread 视为未应用 pack"。

### N4. §6.1 `pack.export` 应砍到 P2
"可选 P1" 但实际涉及资产解析 + zip 打包 + 路径序列化，不是 trivial。建议直接挪到 P2 或非目标。

### N5. §7.1 `appsec.enabled: true` 默认 vs Q1 建议不一致
§7.1 注释写"只读 AppSec 允许默认 true 或首次确认后 true"，Q1 建议也是首次确认。**建议把 §7.1 的 `enabled: true` 改成 `enabled: false` + `available: true`**，与 D10 默认最小权限一致；apply AppSec pack 时弹一次确认 modal "AppSec 是只读浏览器工具集，是否启用？"。

### N6. §7.3 D `netsec` 默认 `target_allowlist: []` = 拒绝一切
✅ 这是对的。但 §7.1 注释也写"空 = 必须用用户/管理员配置的 allowlist"——建议把"空 = 拒绝"作为 spec §7.3 D 顶部显式声明，并单测。

### N7. Cockpit Shell 在 L0/L1/L2 的可见性
§9.2 只说"L1 用户展开或 L2"。建议明确：
- L0：完全不可见
- L1：可见但禁用（提示切到 L2）
- L2：可用

否则 Side Panel L0 用户看到 Shell 入口会很困惑。

### N8. Thread 字段 `netsec_scope_snapshot?`
§6.4 引入这个字段是为了审计——apply 时拷 allowlist 快照。**但 spec 没说快照何时失效**（allowlist 改了之后旧 thread 仍用旧快照？）。建议：thread 启动 netsec 任务时**实时读** config 的 allowlist，不依赖 snapshot；snapshot 只在 audit log 里记录"当时的 allowlist 哈希"。

### N9. `pack.install` 接受 zip / 目录 / 内置资源
§6.3 三种来源都列了，但**没说 zip 的最大解压大小**（防 zip bomb）。建议硬上限（如 50MB 解压后 + 1000 entries）。

### N10. §10 P1 DevSec workspace 与 MCP filesystem 耦合
"与 MCP filesystem / 只读文件工具绑定"——但用户可能没装 MCP filesystem server。建议：DevSec workspace P1 不强依赖 MCP，companion 提供内置只读 `list_dir` / `read_file` 工具（spec §7.3 B 已经写了"或 Companion 包装"，把"或"改成"**默认**"，MCP 作为可选增强）。

---

## 4. Q1–Q5 我的回答

| # | 建议 | 我的判断 |
|---|------|---------|
| Q1 | AppSec 默认 `enabled: true`？ | **修改建议**：`available: true, enabled: false` 默认；apply AppSec pack 时弹一次"启用 AppSec（只读）"确认。比"装完就 true"对齐 D10，比"装完就 false 永远不引导"对用户友好。 |
| Q2 | `system_prompt_append` 新键？ | **是**（M2 阻塞）。 |
| Q3 | xterm.js vs ghostty-web？ | **xterm.js**（P1′）。成熟、MIT、ChromeOS/Mac/Linux 都跑过；ghostty-web 0.4MB WASM + 不明 license 风险，留 P2 实验。 |
| Q4 | 捆绑 nmap？ | **不**（与 Pi/Claude 共识一致）。PATH 探测 + 可选安装器组件目录。 |
| Q5 | Pack vs skill-craft？ | 同意建议默认。补充：pack 可声明 `crafted_skills: true` 让 UI 知道这些 skill 来自 craft 流，但**不**自动加 `requires_modules`。 |

---

## 5. 可行性核查（vs CMspark 实际架构）

| 设计假设 | 验证 |
|---------|------|
| Thread 字段可扩展（`mission_pack_id` 等） | ✅ thread-manager 加字段 + 反序列化默认即可；老 thread 迁移成本 = 0（缺字段视为 null） |
| `tool_whitelist null = all` | ✅ 设计正确处理；`intersect` 模式的"全工具集合"需要从 tool-definitions 注册表拿（M1） |
| `config_override.system_prompt` 整段覆盖 | ✅ 设计正确识别问题（M2），需加 `system_prompt_append` 键 |
| Skill engine secondary root | ⚠️ 需要看 skill-engine 是否原生支持 multi-root；若不支持，pack skill 装载要改 engine（**plan 阶段需验证**） |
| SecurityConfirmationManager 多 kind | ✅ 现有 Promise-based 队列可扩展；Shell/NetSec 加新 message type 即可 |
| DATA_DIR = `~/.cmspark-agent` | ✅ 设计落 `packs/` / `modules/` / `logs/capability-audit.jsonl` 都合理；`modules/` 目录在 v1 可以不创（模块配置全在 config.json） |

**最大未验证风险**：skill-engine 的 secondary root 支持。建议 PR-A 的 first task 就是 spike 验证，若不支持则 §6.6 落回"复制到 `skills/pack--<id>--<name>.md`"方案。

---

## 6. PR 切片评估

§14 切片合理。一个微调：

- **PR-A** 应包含 **M2**（`system_prompt_append` 加入 ALLOWED 键）——这是 schema 之外的独立小改，单独成 commit 反而干净
- **PR-B** apply 流程必须把 **M5**（atomic apply）+ **M6**（uninstall 回滚）写进同一 PR 的测试，不能拖到后面
- **PR-D** audit jsonl 必须把 **M7**（文件属性 + 写入语义）作为验收项
- **PR-F**（Shell）必须包含 **M3**（per-command 默认 + TIOCSTI 防护）作为 acceptance，不能"先 ship session 级，后面再加 per-command"

---

## 7. 总结

平台层（Mission Pack）的设计**已经可以进 plan**；企业模块（Shell/NetSec）的**轮廓对，但安全合同细节要在各自 PR 进入实现前补完**（M3/M4/M7）。M1/M2/M5/M6/M8 是 P0 AppSec 落地前必须解决的——它们都不大，但漏了会变成"pack 平台从一开始就埋雷"。

---

**Verdict: APPROVE_WITH_CHANGES**

Must-fix（进入 plan/实现前）：
- M1: `intersect` 全工具集合的权威源 + 单测
- M2: `system_prompt_append` 加入 `ALLOWED_CONFIG_OVERRIDE_KEYS`（P0 PR-A）
- M3: Shell 默认 per-command 确认 + TIOCSTI 防护写进 spec
- M4: NetSec allowlist 匹配算法规范化（含 IPv4-only / 多级通配语义）
- M5: `pack.apply` 原子化（prepare-then-commit + 失败回滚）
- M6: Pack uninstall 后 Thread 字段清理策略（推荐 snapshot 回滚）
- M7: 审计日志 0o600 + O_APPEND + 行大小上限
- M8: `pack.install` zip entry 逐条 realpath containment

修完以上 8 条，可进 writing-plans。N1–N10 在实现 PR 内顺手处理即可。

**Confidence: 86%**

（扣 14%：skill-engine secondary root 是否原生支持未验证、NetSec 企业安装器形态仍依赖外部确认、Shell PTY isolation 实现细节在 TIOCSTI 这层还需要 spike。这些都不是方向问题，是 plan 阶段需消化的细节。）
