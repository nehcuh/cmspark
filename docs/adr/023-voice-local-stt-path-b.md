# ADR-023: 本机语音识别 Path B（Local STT / whisper.cpp）

**日期**: 2026-08-07 | **状态**: **Accepted**（**M0+M1+M2 shipped in 0.5.0** — 下载 + `voice.stt.*` 闭环 + progressive partial；**非** default-on local。2026-08-09：PATH fallback 仅 `CMSPARK_WHISPER_PATH_FALLBACK=1`；Tier-1 pin **fail-closed** 未 pin 架构；privacy_ack_v2 服务端强制。Win/Linux pin 哈希与自包含二进制仍为残余）  

**相关**:  
- [ADR-001](001-extension-companion双层拓扑.md) 双层拓扑  
- [ADR-002](002-websocket-openai-streaming协议.md) WS 协议族扩展  
- [ADR-020](020-capability-model-three-axes.md) 能力三轴  
- M1 浏览器听写 SoT：[2026-08-06-voice-input-design.md](../superpowers/specs/2026-08-06-voice-input-design.md)  
- Path B 产品 SoT：[2026-08-07-voice-local-stt-design.md](../superpowers/specs/2026-08-07-voice-local-stt-design.md)  

**过程**:  
- 四路对抗合成：[voice-local-stt-adversary-synthesis-20260807.md](../audit/reviews/voice-local-stt-adversary-synthesis-20260807.md)  
- Pi 复审：**APPROVE_WITH_NITS**（`docs/audit/reviews/voice-local-stt-design-pi-20260807-154150.*`；nits 已并入产品 SoT）  
- Strawman（对照，非 SoT）：[2026-08-07-voice-local-stt-design-strawman.md](../superpowers/specs/2026-08-07-voice-local-stt-design-strawman.md)

> **规范优先级**：本 ADR 为 Path B **决策与 Trust / 协议门禁 SoT**。交互细节、错误表、波次验收以产品 SoT 为准；冲突时：**Trust / 安全 / 协议门禁以本 ADR 为准**，UX 文案与布局以产品 SoT 为准。

---

## 1. 背景与问题

### 1.1 现象

M1 语音输入（2026-08-06）锁定 **Web Speech in Side Panel**：点按听写 → 草稿 → 手发；音频 **不经** Companion。设计 SoT 将 **Companion / Whisper STT（Path B）** 明确列为停车场（F-S7），须 **新 ADR + 对抗** 后方可开做。

用户与内网场景的真实痛点：

1. **隐私**：Chrome 听写常走厂商云 STT；音频出站不可控  
2. **环境**：离线 / 受限网络下浏览器 STT 不可用  
3. **可控**：希望自行选择本机模型档、显式下载，而非静默云服务  

### 1.2 为何不能「直接复用 computer 模型下载」

Computer Use 的 Qwen3-VL 下载/运行属于 **Surface L2 实验定位层**（`computer.model.*`、license 门、坐标链）。Path B 是 **Surface L0 输入形态**：

- 不授予工具、不抬 L2  
- 音频进 Companion 改变 **Trust residual**，与 M1「Companion 不见音频」叙事相反  
- 须独立消息族、独立磁盘预算、独立模块树，避免与 CU 命名空间/许可证门纠缠  

### 1.3 非目标（本 ADR 明确不做）

| 非目标 | 原因 |
|--------|------|
| 默认开启本机引擎 / 自动下载权重 | 惊喜下载与供应链面 |
| 静默回落浏览器云 STT | 隐私契约（用户选 local 即拒绝云路径） |
| auto-send / 唤醒 / 常听 / TTS | M1 floors；另开对抗 |
| `audioCapture` manifest 权限 | 扩展权限膨胀；用 document `getUserMedia` |
| Worker / Cockpit / tray 🎤 | 主线程 composer only |
| faster-whisper / Python STT 双栈 | v1 单栈 whisper.cpp |
| Companion 绑定系统 **ffmpeg** | 打包/CVE/第二原生矩阵 |
| 音频或全文转写进 history / 遥测 | 数据最小化 |
| Pack / LLM 写入 voice 引擎或 ack | 风险开关防注入 |
| 「比系统听写更准」质量 SLA | 无 golden 前禁止营销承诺 |
| 语音授工具 / 绕过 L2 | Trust 单调 |

---

## 2. 决策摘要

> **在保持 M1 浏览器听写为默认的前提下，提供可选「本机转写」：用户显式下载 Whisper 权重；Companion 随包提供经完整性校验的 `cmspark-whisper`（whisper.cpp）；Side Panel 采集 16 kHz mono PCM，经已鉴权 WebSocket 分片送 Companion，临时落盘后子进程转写，文字回填草稿（默认可改再发）。不抬 Surface/L2，无 auto-send，主线程 only；失败不静默回云。**

产品叙事一句：

> **可选：在本机 Companion 转写你的语音（需下载模型）；默认仍是浏览器听写；始终只进草稿、不自动发送。**

---

## 3. ADR-020 坐标（能力声明）

```text
Surface:      L0 输入 only（composer 草稿；不发起工具）
L2-classes:   (none) — voice never grants tools / never elevates confirm
Compose:      none — Pack 不得写 voice* / sttEngine / localModelId / ack / auto-send
Autonomy:     n/a — 主线程 composer only；无 worker 🎤
Trust:        mic (OS/Chrome) +
              [browser] vendor STT residual (may leave device) OR
              [local] authenticated WS → Companion memory/tmp → whisper.cpp residual
              (disk until unlink; no durable audio; STT path not cloud-by-design);
              no auto_approve* / god-mode writes; no voice_auto_send;
              weights: user-triggered HTTPS + sha256 download residual
Channel:      community; default engine=browser; local = explicit opt-in after privacy ack v2
```

| 轴 | 放置 |
|----|------|
| **Surface** | 仍为 L0 输入；**不**因本机推理变成 L2 |
| **Composition** | 不引入 Pack/Skill 装配；模型下载是用户资源管理，非场景配方 |
| **Autonomy** | 非编排；单用户主线程 |
| **Trust packaging** | 双引擎 residual 必须诚实披露；local 改变「音频是否触达 Companion」 |

**治理（ADR-020 §7）**：新增 WS 消息族 `voice.stt.*` / `voice.model.*` 属 **新消息族**，以本 ADR 为授权依据；实现 PR 须贴上表 checklist。

---

## 4. 架构

```text
┌─ Side Panel (Extension) ─────────────────────────┐
│  🎤 同一手势（M1 session-reducer）                 │
│  engine=browser → Web Speech（零音频 WS）          │
│  engine=local   → getUserMedia → PCM 16k mono     │
│       │ voice.stt.{start,chunk,end,abort}          │
│       │ origin: chrome-extension:// · auth'd WS    │
└───────┼────────────────────────────────────────────┘
        ▼
┌─ Companion ──────────────────────────────────────┐
│  companion/src/voice/  （禁止塞入 computer.*）      │
│  stt-session     全局 max-1 · epoch · 字节/时长 cap │
│  whisper-runner  execFile cmspark-whisper · 超时杀 │
│  whisper-download 用户触发 · https · sha256 · 预算  │
│  binary-resolve  随包路径 + SHA256 pin              │
│  tmp: DATA_DIR/tmp/voice-stt/<id>  0o600 · 用后删  │
│  config.voice.{ sttEngine, localModelId, … }       │
└──────────────────────────────────────────────────┘
```

**与 M1 关系**：Path B **扩展**听写引擎选择；**不撤销** M1 floors（无 auto-send、≤45s 收听、主线程、privacy 版本化 ack）。`engine=browser` 时 **零回归**（含 Companion 断连仍可浏览器听写）。

---

## 5. 锁定决策 L1–L16

| ID | 锁 |
|----|-----|
| **L1** | 默认 `sttEngine=browser`；local 仅用户 opt-in；**禁止**安装/升级自动下载权重或自动更新权重。 |
| **L2** | 运行时 v1 = **whisper.cpp 子进程** only；CPU 为主；GPU/Metal 可选不阻塞 MVP。 |
| **L3** | 音频路径 = **Extension 采集 → 鉴权 WS → Companion**；禁止 v1 Companion 直接采麦。 |
| **L4** | 音频格式 = Extension 产出 **16 kHz mono PCM/WAV**；**禁止** Companion 依赖系统/随包 **ffmpeg** 作为 v1 硬依赖。 |
| **L5** | 二进制 `cmspark-whisper` **随 Companion 平台包**发布（Tier-1：macOS arm64/x64、Windows x64）；`resolveWhisperBinary()` + **per-arch SHA256 pin**；哈希失败 → Disable local，**禁止**静默 PATH 回落。 |
| **L6** | 权重目录 `~/.cmspark-agent/models/whisper/`；catalog v1：`small` \| `medium` \| `large-v3-turbo`；UI **主推 medium**（spike 实测可改推荐档，不改架构）。 |
| **L7** | 下载/删除/set_active/set_engine 变更：**`source:"settings"` 双栏**（与 `computer.model.*` 同纪律）；**禁止** chat/tool/Pack 触发下载。 |
| **L8** | 磁盘预算 **`voice.modelDiskBudgetMB` 默认 4096**，budget 核算 **scoped 到 whisper 根**；禁止与 Qwen/`models/` 父树混算双计。 |
| **L9** | **全局最多 1 个** STT session；session 绑定创建它的 `ws`；`sessionId`+epoch；乱序/超限/断连 → abort + unlink，**不**合并草稿。 |
| **L10** | 超时：收听 **45s**（客户端+服务端）；upload idle **10s**；推理 **90s**；abort 时 SIGTERM→SIGKILL 子进程。 |
| **L11** | tmp 仅 `DATA_DIR/tmp/voice-stt/…`，realpath containment，文件 **0o600** / 目录 **0o700**；result/error/abort/timeout/WS close/关机 + **boot GC** 必须 unlink；**永不**写入 threads/history。 |
| **L12** | 日志/审计：允许 code、size、ms、modelId；**禁止** base64 音频与全文 transcript。 |
| **L13** | **禁止**静默回落 browser STT。允许错误 banner **显式 CTA**「改用浏览器听写」：必须走 `voice.model.set_engine` + **`source:"settings"`** + 同行云 residual 披露 + toast。 |
| **L14** | **`voice_privacy_ack_v2`**：local 首次或 browser→local 前强制；v1 ack **不**满足 local；未 ack 不得 `voice.stt.start`。 |
| **L15** | Pack apply/install **剥离/拒绝** 任何 `voice*`、`sttEngine`、`localModelId`、`voice_privacy_ack*`、auto-send 类键。 |
| **L16** | 无 `audioCapture`；mic 仅扩展文档 `getUserMedia`；Tier-1 = Google Chrome desktop · macOS / Windows x64。Linux local = Tier-2（无二进制则 Disable，禁半残）。 |

---

## 6. 配置与数据所有权

| 项 | 真源 | 说明 |
|----|------|------|
| `voiceInputEnabled` | Extension `chrome.storage.local` | M1 延续 |
| `voice_privacy_ack_v2` | Extension `chrome.storage.local` | local 门闩 |
| `config.voice.sttEngine` | **Companion** `config.json` | `browser` \| `local`，默认 `browser` |
| `config.voice.localModelId` | **Companion** | allowlist 模型 id |
| `config.voice.modelDiskBudgetMB` | **Companion** | 默认 4096 |
| 下载就绪 / 进度 / 二进制健康 | Companion FS + 进程态 | 扩展只读镜像 |
| `lastKnownEngine` / `lastKnownModelId` | Extension 持久镜像 | 断连 fail-closed：镜像为 local 且 Companion 不可用 → **Disable mic**，禁止当 browser 静默使用 |

**规则**：

1. **禁止** chrome.storage 与 Companion **双写互争** engine/model。  
2. `set_engine local` 在无就绪模型时 **拒绝写配置**；设置页允许 **UI draft** 先下载再提交（产品 SoT §6.1 / §7）。  
3. banner CTA 切 browser **必须** `source:"settings"`，与设置页同源校验。

---

## 7. WebSocket 协议族（v1）

### 7.1 消息

| 类型 | 方向 | 用途 |
|------|------|------|
| `voice.stt.start` | E→C | `{ v:1, sessionId, modelId, format, sampleRate:16000, channels:1, lang, maxMs:45000 }` |
| `voice.stt.chunk` | E→C | `{ v:1, sessionId, seq, data:base64 }` |
| `voice.stt.end` | E→C | `{ v:1, sessionId, totalSeq }` |
| `voice.stt.abort` | E→C | `{ v:1, sessionId }` |
| `voice.stt.partial` | C→E | status：`receiving` \| `transcribing` \| **`hypothesis`**；**M2** 在 `hypothesis` 时可选 `text`（累计音频 re-decode，**非** decoder token 假流） |
| `voice.stt.partial_request` | E→C | `{ v:1, sessionId }` — 请求一次渐进假设（服务端限流；不足音频 / 忙则静默跳过） |
| `voice.stt.result` | C→E | `{ v:1, sessionId, text, ms, modelId }` |
| `voice.stt.error` | C→E | `{ v:1, sessionId, code, message }` |
| `voice.model.get_state` | E→C | 镜像状态 |
| `voice.model.download` / `cancel` / `delete` / `set_active` / `set_engine` | E→C | **变更类强制 `source:"settings"`** |

### 7.2 门禁

1. 必须先 **WS auth**；`voice.stt.*` 允许 `Origin` 类 `chrome-extension://`，**或**（`Origin` = `cmspark-tray://local` **且** handshake `surface` = `summoner`）。tray surface（含缺省）**仍拒绝**。`voice.model.*` 不从此门放行。`privacy_ack_v2` 不放松。  
   `surface` 是 handshake 上的客户端声明（HMAC 才是真门；tray 自称 summoner 只多本地 STT，弱于 tray 已有全权）。overlay **按下麦克风** 视为 `privacy_ack_v2` 的用户手势。  
2. 未知 `v` → error，禁止静默忽略。  
3. 分片强制；单片与会话聚合字节 cap（建议 raw ≤ **2.5MB** / 对齐 45s PCM）；超限 `payload_too_large`。  
4. `modelId` ∈ 服务端已安装 allowlist；路径 **仅服务端解析**，禁止客户端任意 path。  
5. 晚到 chunk/result（epoch 已 bump）→ **no-op**，不写草稿。

协议演进：破坏性变更升 `v`；产品 SoT 可补字段但不得削弱本 ADR 门禁。

---

## 8. 隐私与文案

### 8.1 双引擎通道矩阵（强制）

| 通道 | `engine=browser` | `engine=local` |
|------|------------------|----------------|
| Mic → STT | 浏览器厂商（常云端） | Ext → Companion → tmp → whisper.cpp |
| 音频经 Companion？ | **否** | **是（临时）** |
| 文字 → LLM | 用户发送后，与键入相同 | 相同 |
| 持久化 | 仅消息文本 | 同；**无音频** |

### 8.2 禁止文案

- 「完全本地 / 完全离线 / 零风险 / 绝对隐私」  
- local 模式下仍展示 M1「音频不经过 Companion」  
- 无 residual 的「比浏览器听写更安全」

### 8.3 `voice_privacy_ack_v2` 必含条款

1. 音频经本机 Companion 临时转写后删除  
2. 默认不自动发送  
3. 模型需用户下载（网络 + 校验）  
4. 不保证 OS 交换区/崩溃转储等零痕迹  
5. 浏览器听写仍可能走厂商云  
6. v1 ack 不满足 local  

---

## 9. 安全边界（与实现对齐的验收点）

| 面 | 要求 |
|----|------|
| 下载 | https only；redirect 手控；Content-Length + 流内超收 abort；sha256 后原子 rename；用户显式；无定时自动更新 |
| 子进程 | `execFile` 无 shell；固定 binary；env 收敛；stdout 解析 allowlist；超时 kill tree |
| 并发 | 全局 1 session；第二 `start` → `session_busy` |
| Qwen 共存 | 下载走预算 fail-closed；若 Qwen-VL **已 loaded** 再开 local STT → **用户 confirm**（产品 SoT）；不得静默 OOM |
| Pack | 见 L15；须有单测 |
| Manifest | CI/审查：无 `audioCapture` |

---

## 10. 模块边界

```text
chrome-extension/src/sidepanel/voice/
  local-stt-adapter.ts · pcm-encode.ts · （共用 session-reducer / error-map 扩展）

companion/src/voice/
  stt-session.ts · whisper-runner.ts · whisper-download.ts
  whisper-handlers.ts · whisper-manifest.ts · binary-resolve.ts
```

- **禁止** 使用 `computer.model.*` 消息名承载 Whisper。  
- 下载 **复用** model-download **primitives**，**fork** whisper manifest schema（非 TinyClick/Qwen zod）。  

---

## 11. 波次与门禁

| 波次 | 内容 | 进入条件 |
|------|------|----------|
| **P0** | 本 ADR + 产品 SoT + 对抗 + Pi | **已完成**（Pi APPROVE_WITH_NITS） |
| **Spike** | S0–S5 | **机器 PASS**（2026-08-07）；报告 [voice-local-stt-spike-report](../superpowers/specs/2026-08-07-voice-local-stt-spike-report.md)；**人工 S0–S2 PENDING** |
| **M0** | manifest + download/cancel/delete/progress + get_state + 设置 UI | 实现计划：[voice-local-stt-m0-impl](../superpowers/plans/2026-08-07-voice-local-stt-m0-impl.md)；机器 spike 已过即可开；**无** `voice.stt.*` 生产闭环 |
| **M1** | binary + runner + STT WS + adapter + processing + ack v2 + 错误表 | 实现计划：[voice-local-stt-m1-impl](../superpowers/plans/2026-08-07-voice-local-stt-m1-impl.md)；人工 S0–S2 + CI pure + fake runner |
| **M2+** | 硬 RAM 互斥、GPU、流式 partial、更多质量叙事 | 若动 auto-send/权限 → **重开对抗** |

**实现前禁止**：在 Spike 未过时合并生产 `voice.stt.*` 处理路径。

---

## 12. 后果

### 12.1 正面

- 满足隐私/内网用户的 STT 路径本机需求，且默认路径仍零下载  
- Trust 叙事与 M1 分引擎诚实，避免「不经 Companion」全局口号在 Path B 后失效  
- 与 Qwen 下载管线同构的用户控制感（显式下载、可删、可取消），但命名空间隔离  

### 12.2 代价与残余

- Companion 安装包增大（每平台 whisper 二进制）  
- 用户磁盘/内存占用；与 Qwen-VL 同机需 confirm  
- 音频短暂出现在 loopback WS 与 tmp（R-B1/R-B2，见产品 SoT §13）  
- 维护 manifest、镜像源、跨平台二进制 CI  

### 12.3 与 M1 的关系

| M1 | Path B |
|----|--------|
| F-S7「Path B 禁 v1」 | **被本 ADR 取代**（开做条件已满足：对抗 + Pi + 本 ADR） |
| Companion 不见音频 | **仅 browser 引擎仍成立**；local 见矩阵 |
| prefs 仅 chrome.storage | **部分推翻**：engine/model → Companion（enable/ack 仍 chrome） |

---

## 13. 修订记录

| 日期 | 变更 |
|------|------|
| 2026-08-07 | 初版 Accepted：四路对抗 + Pi nits 吸收；L1–L16；WS 族；配置所有权；波次门禁 |

---

*End ADR-023 — Path B Local STT.*
