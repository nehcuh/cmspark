# 本机语音识别（Path B Local STT）— 产品设计 Strawman（待对抗）

> **日期**: 2026-08-07  
> **状态**: STRAWMAN — 供多路对抗攻击，**非**锁定 SoT  
> **前置 SoT**: [2026-08-06-voice-input-design.md](./2026-08-06-voice-input-design.md)（M1 Web Speech 已锁；Path B 原为 M3 停车场）  
> **用户预决策（对话收敛，可被对抗推翻）**:  
> - 运行时：**whisper.cpp 子进程**  
> - 音频：**Extension 录音 → 鉴权 WS → Companion**  
> - 模型目录 v1：**small / medium / large-v3-turbo**，用户选择下载  
> - 二进制：**随 Companion 发布预编译**；权重用户下载  
> **ADR**: 须新建 Path B ADR（020 仅声明 L0；本能力改变 Trust 通道）

---

## 0. 一句话（草案）

**用户在设置中可选「浏览器听写」或「本机模型」；选本机时自行下载 Whisper 权重，Companion 随包提供 whisper.cpp，Side Panel 录音经鉴权 WS 送本机转写后写入草稿（默认可改再发）；不抬 L2、无 auto-send、主线程 only。**

---

## 1. 问题 / JTBD（用户视角）

| | |
|--|--|
| **谁** | 已会用 M1 🎤 的中文用户；对云 STT 隐私不满，或 Web Speech 中文质量不够 |
| **场景** | 离线/内网；不想音频出站；希望比系统听写更稳的中文术语/API 名 |
| **失败态今天** | 只有浏览器听写；质量与隐私不可控；无法换模型 |
| **成功（可验收）** | 设置选本机 → 下载完成 → 点 🎤 说 ≥15 字中文 → 草稿可编辑发送；全程无浏览器云 STT |
| **非成功** | 默认 bulk 下载；说完自动发送；语音 Agent；Worker 🎤 |

### 1.1 用户心理路径（草案，待 Product 攻击）

1. 发现：设置里「语音」有「本机模型」选项（或首次听写差时引导？）  
2. 理解代价：磁盘 ~0.5–1.6GB、首次下载、本机 CPU/GPU 占用说明  
3. 决策：选 small/medium/turbo 之一 → 点下载 → 进度可取消  
4. 切换引擎：仅「已就绪」模型可选为当前；未下载灰显 +「下载」  
5. 使用：与 M1 同一 🎤 手势；listening 时若引擎=local 显示小徽章「本机」  
6. 失败：本机失败时 **不静默回落云 STT**（隐私契约）；提示可改回浏览器或重试  

---

## 2. 目标 / 非目标

### 2.1 目标 v1（Path B MVP）

1. 设置：`voiceSttEngine`: `browser` | `local`（默认 **browser**）  
2. 设置：`voiceLocalModel`: `small` | `medium` | `large-v3-turbo`；仅已下载可选为 active  
3. 用户触发下载/删除/取消；进度广播；磁盘预算（复用/对齐 model-download 语义）  
4. 预编译 `cmspark-whisper` 随 Companion（darwin arm64/x64、win x64 至少 Tier-1）  
5. Extension MediaRecorder → WS 分片 → Companion 临时文件 → whisper.cpp → 文字回填草稿  
6. 继承 M1 floors：无 auto-send、≤45s、主线程、privacy ack **v2**（通道变了必须重 ack）  
7. 诚实资源提示（模型大小 / 约需内存 / 与 Qwen-VL 同机互斥文案）

### 2.2 非目标 v1

| 非目标 | 理由 |
|--------|------|
| 默认本机引擎 | 零成本默认仍 browser；避免惊喜下载 |
| 自动选择「最佳」模型下载 | 用户显式；永不自动网络更新（对齐 Qwen） |
| faster-whisper / Python STT | v1 单栈 cpp；双栈停车 |
| 流式 partial 字（token 级） | whisper.cpp 批次转写即可；interim 可用「识别中…」 |
| TTS / 唤醒 / 常听 | M1 非目标延续 |
| `audioCapture` manifest | 仍禁；用 getUserMedia in extension page |
| 云 STT URL 配置 | 可 M2；非「本机」叙事 |
| Worker / Cockpit 🎤 | F-S9 |
| 转写/音频进遥测或 history | F-S6 加强：音频零持久（会话 tmp only） |

---

## 3. 方案选型（草案锁）

| 层 | 选择 | 备选（停车） |
|----|------|----------------|
| 运行时 | whisper.cpp 子进程 | faster-whisper |
| 音频路径 | Ext → WS → Companion | Companion 直接采麦 |
| 二进制 | 随包预编译 | 首次下载 binary |
| 权重 | 用户选 small/medium/turbo | 全档 / 仅 medium |
| 默认引擎 | browser | local after ready |

---

## 4. UX 草图（产品交互）

### 4.1 设置 → 语音输入（扩展现有块）

```text
[x] 启用语音输入

转写引擎
  (•) 浏览器听写 — 无需下载；可能使用浏览器云端服务
  ( ) 本机模型 — 音频仅在本机 Companion 转写

本机模型（引擎=本机时展开）
  当前模型: [ medium ▼ ]   状态: 已就绪 | 未下载 | 下载中 42%
  [下载] [取消] [删除]
  提示: medium 约 1.5GB 磁盘 · 运行约 2–4GB 内存
  与「电脑控制实验模型」同时开启可能争用内存

隐私（版本 voice_privacy_ack_v2）
  … 依引擎动态一段 …
```

### 4.2 Composer

- 同一 🎤；engine=local 时 listening 角标「本机」  
- processing（上传/推理）态：mic 转圈，可取消 → abort session  
- 失败：**不**自动切 browser；toast + 设置入口  

### 4.3 隐藏/禁用矩阵（草案）

| 条件 | Mic |
|------|-----|
| voiceInputEnabled false | Hide |
| engine=browser 且无 SpeechRecognition | Hide（现有） |
| engine=local 且无就绪模型 | **Disable** +「请先下载本机模型」 |
| engine=local 且 Companion 断连 | Disable +「Companion 未连接」 |
| engine=local 且二进制缺失 | Disable +「本机听写组件不可用」 |
| thread_busy | 禁 start（继承 M1） |

---

## 5. 信任 / 隐私 / ADR-020（草案）

```text
Surface:      L0 输入 only
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        mic + 音频经 WS 至本机 Companion；临时文件；无云 STT（local 模式）；
              不写 auto_approve*；无 voice auto-send
Channel:      community opt-in（默认仍 browser）
```

### 5.1 通道模型（替换 M1 三通道在 local 下的语义）

| 通道 | browser 引擎 | local 引擎 |
|------|--------------|------------|
| Mic → STT | 浏览器厂商（可能云） | **本机 Companion + whisper.cpp** |
| 音频是否经 Companion | 否 | **是（仅转写，用后删）** |
| 文字 → LLM | 发送后相同 | 相同 |

**禁止文案**: 「完全离线安全」若 Companion 配置了会外发的代理/遥测——只保证 **STT 路径** 本机。  
**强制**: 切到 local 或首次用 local 前 **voice_privacy_ack_v2**。

### 5.2 安全边界（草案）

- WS 消息仅 authenticated extension  
- 音频 blob 大小/时长 cap（对齐 45s + 比特率上限）  
- tmp 路径 sandbox 在 DATA_DIR；会话结束/ abort / 超时 **unlink**  
- 下载：https only、sha256、磁盘预算、用户显式触发（复用 model-download 模式）  
- 不把音频写入 threads/history  

---

## 6. 协议草案（WS）

| 消息 | 方向 | 用途 |
|------|------|------|
| `voice.stt.start` | E→C | sessionId, model, format, lang |
| `voice.stt.chunk` | E→C | sessionId, seq, base64/binary |
| `voice.stt.end` | E→C | sessionId |
| `voice.stt.abort` | E→C | sessionId |
| `voice.stt.partial` | C→E | optional status only（「识别中」） |
| `voice.stt.result` | C→E | text, ms, model |
| `voice.stt.error` | C→E | code, message |
| `voice.model.*` | settings only | download/cancel/delete/set_active/status — **source:settings** |

---

## 7. 配置落点（草案冲突点 — 待对抗）

| 项 | 草案 | 冲突 |
|----|------|------|
| engine / model prefs | 部分在 `chrome.storage.local`（扩展 UX），下载状态在 Companion | M1 听写 prefs 全在 chrome.storage；Path B 下载必须 Companion |
| 建议 | **engine + activeModelId** 双写或以 Companion config 为准、扩展镜像 | Impl 攻击单源真相 |

---

## 8. 波次（草案）

| 波次 | 内容 |
|------|------|
| P0 | 四路对抗 + 合成 + Pi 复审 + ADR 草案 |
| M0 | manifest + download/delete/progress（可无听写） |
| M1 | binary 打包 + runner + WS 闭环 + 引擎切换 + ack v2 |
| M2 | 资源互斥 UX、lang、流式 partial、更多模型档 |

---

## 9. 待对抗必须回答的问题

1. **失败是否允许一键「改用浏览器听写」？**（便利 vs 隐私误触）  
2. **下载是否允许在 Side Panel 内完成，还是仅设置页？**  
3. **local 时 interim 空白是否可接受？**（vs 假 interim）  
4. **引擎选择是否应在首次 🎤 失败后主动推荐本机？**  
5. **与 Qwen-VL 同机：下载前硬拦截还是仅文案？**  
6. **prefs 单源：Companion config vs chrome.storage**  
7. **WebM/Opus vs PCM**：谁解码、whisper 输入格式  
8. **二进制签名/完整性**：与 cmspark-host 同级校验？  

---

## 10. 成功指标（草案）

- 用户从「未下载」到「首次成功本机听写」≤ 3 次关键点击 + 下载等待  
- 中文 ≥15 字指令可编辑发送率（人工表）  
- 断连/无模型/下载失败路径无死胡同  
- 零音频残留于 DATA_DIR 超过会话（抽检）  

---

*End strawman — attack this; do not implement yet.*
