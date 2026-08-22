# Computer Use 使用说明

> **面向使用者**：如何开启桌面坐标操控、确认台里怎么批/急停、session-trust 是什么、平台与限制。  
> **产品版本**：0.5.0 · **决策摘要**：[ADR-017](adr/017-computer-use.md)  
> **确认台 UI**：[confirm-center-user-guide.md](confirm-center-user-guide.md) · **Host / Apps**：[host-and-apps.md](host-and-apps.md)  
> **过程史（非规范）**：[decisions/coordinate-computer-use-plan.md](decisions/coordinate-computer-use-plan.md)

### 能力坐标

| 轴 | 本指南位置 |
|----|------------|
| **Surface** | **L2 计算机**（桌面宿主面）— 比浏览器 L1 更深、blast radius 更大；进行中任务以 **确认台 / Cockpit** 为主操控面 |
| **Composition** | 可叠加 Skill/Pack 提示词，但 **不能**用 Pack 关掉任务级确认；实验定位层不得当作写路径成功依赖 |
| **Autonomy** | 通常单线程任务；与 multi-worker **正交**（Worker 硬禁 host_*） |
| **Trust** | 双开关 + **任务级 L2**；god-mode / auto_approve **永不**跳过；session-trust 有条件抑后续 initial L2（§5） |
| **规范** | [ADR-020](adr/020-capability-model-three-axes.md) · [ADR-017](adr/017-computer-use.md) |

---

## 1. 一句话

**Computer Use** 让 Agent 在你**已白名单的应用窗口**上做键鼠坐标操作（点击、键入、滚动等），工具名主要是 **`host_computer`**。  
这是能力模型里的 **深层 / L2 作用面**（不是「再装一种 Agent」）。默认 **关闭**；开启后仍是 **双开关 + 任务级 L2**（**god-mode / auto_approve 永不跳过** 任务确认），不是「打开就全自动接管桌面」。同线程同 App 下，若你勾选 session-trust 且 corpus/预算等条件满足，**后续任务**的初始 L2 可能被静默跳过（见 §5）。

---

## 2. 何时用 / 何时不要用

| 适合 | 不适合 / 请改用其它能力 |
|------|-------------------------|
| 需要点桌面 GUI（播放器、办公窗、本机应用）且无结构化 API | **浏览器内**页面 → **L1** CDP 工具（`click` / `type` / …），不必上 Computer Use |
| 用户明确要求「在某某 App 里点一下」 | 读邮件/写笔记等有 `host_read` / `host_write` 时，优先 [Host Use](host-and-apps.md)（同属 L2，但语义 API 更稳） |
| 短任务、动作预算可控 | 仅网页黑盒 / 投研数据拉取 → [任务包](mission-pack-usage.md) / [MCP](mcp.md)（**组合面**，多在 L0/L1） |
| | 支付/转账/验证码最终确认、密码框键入 — **硬拒绝** |

---

## 3. 启用条件（opt-in，默认关）

要让 `host_computer` 真正执行，需同时满足：

1. **全局坐标开关** `computer.coordinateEnabled === true`  
   - 默认 **false**（fail-closed）。  
   - **产品 0.5.0 用户路径**：Side Panel → 底栏 **应用（Apps）** → 顶部 **「坐标操作」** 勾选；走 Companion `computer.set_enabled`（可经生物识别/确认台门）。  
   - 仍可直接编辑 `~/.cmspark-agent/config.json` 后重启 Companion。  
   - Apps 面板显示的是 **可切换** 状态（非只读镜像）。

2. **Apps 功能打开** 且目标 App 在白名单内（`apps.enabled` + 对应 `AppEntry`）。

3. **该 App 已显式允许坐标** `AppEntry.coordinateAllowed === true`（逐应用，不是全局一开全放）。**例外：浏览器**不能打开这个开关；Chrome 像素点击走 `host_computer` 一次性确认台，不写这个 bit。

4. **结构排除**：密码管理器、终端、钱包、LOLBIN **永远不能** 开坐标。**浏览器**不能把 Apps「允许坐标」打开（防止无人值守静默注入），但 `host_computer` 可以对 Chrome/Safari 等走 **一次性确认**：确认台弹出后必须点允许；无人值守 / 三旗 / 会话信任都不会跳过。

5. **任务级 L2**：`host_computer` 任务在确认台/红条展示任务描述、目标 App、**逐字 type 文本**、动作预算。  
   - **全局开关**（协议解锁 / 自动批准危险 / 企业自动批准）**不能单独**跳过任务级 initial L2。  
   - **G1 session-trust**（§5）：交互批准后，同线程同 App 后续任务在 corpus/预算条件下可 skip。  
   - **无人值守**（§5.1 / [ADR-021](adr/021-unattended-desktop-session.md)）：设置 → 运行自主度 → **无人值守** 短语+双勾选武装后，本 Companion 进程内对 **已开坐标的白名单 App** 的 `host_computer` **任务级 L2 与 mid-task re-L2 均静默**（风险自担；2026-08 产品澄清）。支付/验证码等 **硬拒绝** 仍直接失败、不弹确认窗。重启失效。

### 快速检查清单

- [ ] Companion 已启动，扩展已连接  
- [ ] 已在 Apps 面板打开「坐标操作」（`computer.set_enabled`），或在 `config.json` 设 `computer.coordinateEnabled: true`  
- [ ] 底栏 **应用** 面板：全局 App 已开  
- [ ] 目标 App 已加白名单；**原生 App** 须已开「允许坐标」。**浏览器**不能开该开关，走 `host_computer` 一次性确认（确认台必须点允许）
- [ ] 有确认时打开 **确认台**，看清预览后再批  

---

## 4. 确认台（Cockpit）与急停

Computer Use 与其它高危工具共用 [确认台](confirm-center-user-guide.md)：

| 动作 | 说明 |
|------|------|
| **任务开始 / L2** | 扩展常会 **自动打开或聚焦** 确认台宽窗 |
| **步骤轨** | 宽窗展示进行中任务步骤；侧栏有 Chip 摘要 |
| **急停** | 侧栏 SafetyStrip / 宽窗 **急停** → 中止当前 computer 任务（`computer.task.abort`） |
| **关确认台** | **≠ 停止任务**；任务可能继续跑，可用 Chip 再打开宽窗 |
| **拒绝并停止** | 拒掉当前确认并停相关执行 |

证据目录（任务截图/证据）可从卡片触发 `computer.evidence.open`（有频率上限，路径受 Companion 锁定）。

---

## 5. Session-trust（本会话信任）含义

**Session-trust** 减轻确认摩擦：**mid-task re-L2**（同一任务中途暂停后再继续）以及——在显式 opt-in 与门控满足时——**同线程同 App 后续任务的 initial L2**。它**不是**跨重启、跨线程的永久放权，也**不能**被 god-mode / `auto_approve_dangerous` 打开。

| 点 | 事实 |
|----|------|
| **存什么** | 进程内 grant：某线程（优先 `thread:` key）或某 WS 会话 + App 上的信任状态 |
| **何时写入** | 你批准了**任务级**初始 L2 之后（可勾选「本会话自动同意同类操作」等 UI 文案，以面板为准） |
| **能跳过什么** | ① 部分 **任务中途 re-L2**（如预算耗尽后继续、部分 pause，任务本地即可静默）；② **G1 多任务 initial-L2 skip**：须 **显式 opt-in** + 同 thread key + 同 App + type corpus ⊆ 已批 + budget/actions ≤ 已见上限 + 未过期 + 无凭据闩 + 非 experimental |
| **绝不能静默过** | 危险检测（`danger_detected`）、实验性定位建议（`experimental_suggestion`）、前台让出（`foreground_yielded`）— **始终 prompt**；**协议解锁 / auto_approve 也不能单独**跳过任务级 L2（值守见 §5.1） |
| **失效** | Companion 重启清空；默认 **约 30 分钟** 自上次交互批准空闲过期；OCR 见到凭据界面会 **闩住**，阻止下一轮 initial-skip |
| **不是** | `ThreadApprovals` 的 host 白名单、也不是 `auto_approve_dangerous` / 协议解锁；**也不是**无人值守（见下） |

用一句话：**你已批过「这一会话对这个 App」的范围（并可勾选自动同意同类）；系统在安全标签与 corpus/预算门允许时少问「继续吗」与后续同类任务的初始确认。**

### 5.1 无人值守（桌面值守）与 G1 对照

| | **G1 session-trust** | **无人值守（ADR-021）** |
|--|----------------------|-------------------------|
| 入口 | 确认台勾「本会话自动同意同类」 | 设置 → **运行自主度 → 无人值守** + 短语 + 双勾选 |
| 首枪 initial L2 | **必须**先交互批一次 | 武装后 **跳过**（键入无逐字预览） |
| App 范围 | 已批的那个 app | 每次任务实时 `coordinateAllowed`（**浏览器 one-shot 永不 skip**） |
| type 文本 | 须 ⊆ 已批 corpus | **open_within_app**（不绑 corpus） |
| 寿命 | ~30min idle / 重启清 | **8h 墙钟** / 重启清 / 点解除 |
| 徽章 | （企业信任等） | 顶栏 **值守中 · 桌面** |
| mid-task re-L2（危险/实验/前台） | 始终确认 | **静默通过**（武装=风险自担；硬拒绝仍 throw） |
| 急停 | 停任务 | 停任务，**不等于**解除值守 |

**启用前**：`computer.coordinateEnabled`、Apps 白名单；原生 App 须「允许坐标」。**浏览器**不能开该开关，每次 `host_computer` 都要确认台点允许（值守/G1/三旗都不跳过）。  
**诚实风险**：值守武装 = 风险自担；任务级 L2 与 mid-task re-L2 均静默后，prompt 注入可驱动已放权 App 上的键鼠；OCR 可能漏检部分支付 UI——自负后果。支付/验证码等硬拒绝仍直接失败、不弹窗。

---

## 6. 平台支持

| 平台 | 状态（0.5.0） |
|------|----------------|
| **macOS** | 主路径：原生适配 + 证据/急停；需本机权限（**只认 CMspark**，见下） |
| **Windows** | 主路径：PowerShell/UIA 脚本族 + 窗口捕获；Hello 等与 host 写路径协同处见 host 指南 |
| **Linux** | Computer 坐标注入 **非** 本阶段一等交付；Host 读路径也多为 pending |

具体适配在 `companion/src/computer/`（`darwin-adapters` / `win-adapters` 等）。

### macOS 权限（只认 CMspark）

Computer Use 截图与键鼠需要系统权限。请 **只** 为 **CMspark** 打开：

1. **系统设置 → 隐私与安全性 → 屏幕录制** → 打开 **CMspark**
2. **系统设置 → 隐私与安全性 → 辅助功能** → 打开 **CMspark**
3. **完全退出** CMspark（菜单栏图标退出）后重新打开

**不要**去找或勾选 `node`、`cmspark-host` 等内部进程名。若列表里有历史残留项，可关闭它们；以 **CMspark** 为准。

更新或重装后若截图再次失败：把 CMspark 开关关掉再打开一次（ad-hoc 安装时系统可能要求重新授权）。

> P0 交付路径为 **CMspark.app（DMG）**；其他安装方式（如 install-daemon）的 TCC 身份可能不同，不在本修复范围内。

---

## 6.1 实验层：Qwen3-VL 本机视觉定位（可选）

默认 **关闭**。开启后作为 UIA/OCR 之后的 **L2 建议点**，**每次命中仍要人工确认**。

- **权威在 Companion**：扩展只发 `computer.model.*`，不在浏览器内推理。  
- **用户路径**：设置 → 看「就绪」预检 → 选下载源（大陆推荐自动/魔搭）→ 选 2B/4B/8B → 下载 → 开启。  
- **依赖**：本机 Python3 +（下载）`huggingface_hub` 或 `modelscope` +（推理）`transformers torch pillow`。  
- **中国大陆**：默认 `auto` 会探测 HF/魔搭；显式可选 ModelScope / HF 镜像。  
- **确认文案**：实验层命中时确认台会展示建议坐标；若模型输出中含可解析的 Thought/思考片段，会以「模型思考」短句附在确认文案中（已清洗控制字符，**不**作为自动注入依据）。  
- 完整说明：[qwen-vl-experimental-layer.md](qwen-vl-experimental-layer.md)

## 6.2 与「纯视觉 GUI Agent」（如 UI-TARS）的差异

业界有一类 **截图 → 视觉模型 → 键鼠** 的原生 GUI Agent（例如 ByteDance [UI-TARS](https://github.com/bytedance/UI-TARS) / Desktop）。CMspark **吸收其纪律与解析经验**，但 **产品身份不同**：

| | 纯视觉 GUI Agent（典型） | CMspark Computer Use |
|--|--------------------------|----------------------|
| 默认感知 | 几乎只靠截图 | **UIA/OCR 优先**，可选 Qwen3-VL 建议点 |
| 控制环 | 模型驱动多轮截图循环 | 主对话 **tool-loop** 批量 `host_computer` + 确认台 |
| 信任模型 | 多为本机/演示向 | **双开关 + 任务级 L2 + 硬拒 + 急停**（god-mode 不跳过任务 L2） |
| 人类接管 | pause / Take control | **急停**、拒绝确认、re-L2；关确认台 **不停**任务（见 §4） |

研究与路径决策（工程吸收清单）：[research/ui-tars-absorption-2026-08-08.md](research/ui-tars-absorption-2026-08-08.md) · [decisions/ui-tars-absorption-multipath-2026-08-08.md](decisions/ui-tars-absorption-multipath-2026-08-08.md)。

## 6.3 `host_computer` 动作空间（速查）

| action | 含义 | 备注 |
|--------|------|------|
| `click` / `double_click` / `right_click` | 点击 | 可用 `target` 锚文本定位，或显式 `x,y` |
| `type` | 键入文本 | 必须进 L2 语料逐字枚举 |
| `key` | 命名键和弦 | 白名单键名，非任意 VK |
| `scroll` | 滚轮 | 需客户端坐标 + 非零 delta |
| `drag` | 拖拽 | 起点/终点客户端坐标 |
| `wait` | 等待 | 上限约 5s |
| `screenshot` / `describe` | 观测 | describe = 宿主 OCR 空间行 |

预算默认约 15、上限 30 次注入动作。完整 schema 见 Companion `tool-schemas` / ADR-017。

## 7. 硬限制（请勿指望绕过）

- **支付 / 转账 / 购买 / 验证码最终确认类点击**：硬拒绝，无「再确认一次就放行」。  
- **密码 / PIN 等凭据上下文** 的 type 与键入：硬拒绝。  
- **任务自己弹出的系统对话框**：不会由 Agent 代点，会暂停等人。  
- **窗口离开白名单 / 输入桌面变化 / 环境不安全**：失败关闭（fail-closed）。  
- **动作预算**：默认约 15、上限 30 次注入动作；耗尽需新确认。  
- **type 文本**：须来自任务参数并在确认里 **逐字枚举**；单条与任务语料有长度上限（约 2000 字符量级）。  
- **与 Multi-Agent tab 锁**：存在任意 tab lease 时，**禁止**对 Chrome/Chromium 窗口做坐标点击/键入（须先释放相关 lease）。  
- **Worker 默认硬禁** `host_computer`（见 [multi-agent-user-guide](multi-agent-user-guide.md)）。

---

## 8. 相关文档

| 文档 | 用途 |
|------|------|
| [ADR-020](adr/020-capability-model-three-axes.md) | L2 Surface；与组合面/L1 的边界 |
| [confirm-center-user-guide.md](confirm-center-user-guide.md) | 确认台 / 急停 / L2 分层 |
| [host-and-apps.md](host-and-apps.md) | 应用白名单、`host_read`/`host_write`/`host_app` |
| [ADR-017](adr/017-computer-use.md) | 架构决策摘要 |
| [architecture.md](architecture.md) §9 | 模块与数据流 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 故障速查 |

---

*文档版本：2026-08-10 · 对齐 ADR-020 · Path C UI-TARS 吸收 · 与 companion `computer/*` + 扩展 Cockpit/AppsPanel 行为一致。*
