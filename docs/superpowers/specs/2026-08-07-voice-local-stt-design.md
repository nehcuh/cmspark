# 本机语音识别（Path B Local STT）— 产品设计 SoT

> **日期**: 2026-08-07  
> **状态**: **LOCKED for Pi re-review / spike** — 四路对抗 MAJOR_REVISE 已吸收  
> **对抗合成**: [voice-local-stt-adversary-synthesis-20260807.md](../../audit/reviews/voice-local-stt-adversary-synthesis-20260807.md)  
> **Strawman（已废为对照）**: [2026-08-07-voice-local-stt-design-strawman.md](./2026-08-07-voice-local-stt-design-strawman.md)  
> **前置**: [2026-08-06-voice-input-design.md](./2026-08-06-voice-input-design.md)（M1 Web Speech；本文件 **不撤销** M1 floors，仅扩展 Path B）  
> **ADR**: [ADR-023](../../adr/023-voice-local-stt-path-b.md)（Path B 决策 / Trust / 协议门禁 SoT；交互细节以本文件为准）

---

## 0. 一句话（锁定）

**用户可选「浏览器听写」（默认）或「本机转写」：本机路径下自行下载 Whisper 权重，Companion 随包提供 whisper.cpp；Side Panel 采集 PCM 经鉴权 WS 送本机转写后写入草稿（可改再发）。无 auto-send、不抬 L2、主线程 only；失败不静默回落云 STT。**

---

## 1. 问题与 JTBD

| | |
|--|--|
| **谁** | 隐私/内网/不愿音频出站的中文用户（**非**「人人升级听写」） |
| **场景** | 短中文指令进 composer；需要 STT 路径本机 |
| **成功** | 设置启用本机 → 下载推荐模型 → 🎤 → ≥15 字中文进草稿可编辑发送；无浏览器云 STT |
| **非成功** | 默认 bulk 下载；质量 SLA；语音 Agent；Worker 🎤 |

---

## 2. 目标 / 非目标

### 2.1 目标（MVP = M0 + M1）

1. `sttEngine`: `browser` \| `local`，默认 **browser**（Companion config SoT）  
2. 模型：`small` \| `medium` \| `large-v3-turbo`；**UI 主推 medium**；其他折叠  
3. 用户显式下载/取消/删除；https+sha256；独立磁盘预算；`source:"settings"`  
4. 预编译 `cmspark-whisper` 随 Companion（Tier-1 平台）；SHA256 pin  
5. Extension：16 kHz mono PCM → chunked WS → Companion tmp → whisper.cpp → 文字草稿  
6. 继承 M1：点按 🎤、≤45s **收听**、无 auto-send、主线程、Stop/abort/切线程停  
7. **processing** 态 + listening 计时反馈；`voice_privacy_ack_v2`  
8. M1 browser 路径 **零回归**（含 Companion 断连仍可 browser 听写）

### 2.2 非目标

| 非目标 | 理由 |
|--------|------|
| 默认 local / 自动下载 / 自动更新权重 | 惊喜与供应链 |
| faster-whisper / 双栈 | v1 单栈 |
| ffmpeg 依赖 | 打包/CVE |
| 流式 **decoder token** interim（whisper 内部 token 流） | 仍非目标；见 M2 渐进重解码 |
| **M2 渐进字级假设**（累计音频 re-decode + 前缀稳定） | **已实现**（`voice.stt.partial_request` → `partial.status=hypothesis` + text） |
| auto-send / 唤醒 / TTS | M1 延续 |
| `audioCapture` | F-S5 |
| Worker / Cockpit / tray 🎤 | F-S9 |
| 音频/转写进遥测或 history | F-S6/B12 |
| 「比系统听写更准」承诺 | 无数据前禁止 |
| 静默回落 browser STT | 隐私契约 |

---

## 3. 方案锁定

| 层 | 锁定 |
|----|------|
| 运行时 | whisper.cpp 子进程（CPU；Metal 可选不阻塞） |
| 音频 | Ext gUM + PCM 16k mono → 鉴权 WS → Companion |
| 二进制 | 随包预编译 + resolve + SHA256 |
| 权重 | 用户下载；目录 `~/.cmspark-agent/models/whisper/` |
| 默认引擎 | browser |

---

## 4. ADR-020 声明（Path B）

```text
Surface:      L0 输入 only（composer 草稿；不发起工具）
L2-classes:   (none) — voice never grants tools
Compose:      none — Pack 不得写 voice* / engine / ack / auto-send
Autonomy:     n/a — 主线程 only
Trust:        mic (OS/Chrome) +
              [browser] vendor STT residual (may leave device) OR
              [local] authenticated WS → Companion memory/tmp → whisper.cpp residual
              (disk until unlink; no durable audio; STT path not cloud-by-design);
              no auto_approve* / god-mode; no voice_auto_send;
              weights: user-triggered HTTPS+sha256 download residual
Channel:      community; default engine=browser; local = opt-in after ack v2
```

**规范 ADR**：[ADR-023](../../adr/023-voice-local-stt-path-b.md) 声明 `voice.stt.*` / `voice.model.*` 消息族与 L1–L16 门禁。

---

## 5. 隐私：双引擎通道矩阵（强制）

| 通道 | browser | local |
|------|---------|-------|
| Mic → STT | 浏览器厂商（常云端） | Ext → **本机 Companion** → tmp → whisper.cpp |
| 音频是否经 Companion | 否 | **是（临时，用后删）** |
| 文字 → LLM | 发送后相同 | 相同 |
| 持久存储 | 仅消息文本 | 同；**无音频** |

### 5.1 禁止文案

- 「完全本地 / 完全离线 / 零风险 / 绝对隐私」  
- local 模式下仍显示 M1「音频不经过 Companion」  
- 无 residual 的「比浏览器更安全」

### 5.2 `voice_privacy_ack_v2`（local 首次 / browser→local）

必须包含：

1. 音频 → 本机 Companion → 临时文件 → 本机识别 → 草稿  
2. 默认不自动发送  
3. 模型需用户下载（HTTPS 校验）  
4. 不保证 OS 交换/崩溃转储等零痕迹  
5. 浏览器听写仍可能走厂商云  
6. v1 ack **不**满足 local  

存储：`chrome.storage.local`；**local start 前**扩展必须检查；未 ack 不得 `voice.stt.start`。

### 5.3 失败与「改用浏览器听写」

- **禁止**静默切换引擎  
- **允许** banner CTA：切换 `sttEngine=browser`  
  - 写路径：扩展发 `voice.model.set_engine` **`source:"settings"`**（与设置页同源双栏校验；**禁止**无 source 旁路）  
  - 同行披露「可能经浏览器厂商云端」+ toast「已改用浏览器听写」  
- 不提供「仅本次」幽灵引擎（避免下次 🎤 再炸）

---

## 6. UX

### 6.1 设置（渐进披露）

```text
[x] 启用语音输入

听写方式
  (•) 浏览器听写 — 无需下载；可能使用浏览器云端服务
  ( ) 本机转写 — 需下载模型；音频在本机 Companion 临时转写
        └ 展开（仅 UI 选中本机时，见 §7 草稿态）：
            推荐：medium  [下载|进度|删除]  （体积/内存数字由 spike S3 填实）
            其他型号 ▸ small · large-v3-turbo
            与电脑控制实验模型同时使用可能占用大量内存
```

- **Radio 草稿态**：设置页选「本机转写」先进入 **UI draft**（可下载），**不**在未就绪时 `set_engine local`；仅当至少一档 ready 且用户确认后才提交 Companion `set_engine`（解鸡生蛋）  
- 下载/删除/set_active：**仅设置**，`source:"settings"`  
- 进度：可全局广播（StatusRail/轻量），不强制钉在 slideout  
- 推荐档 **medium** 为文档默认；**spike S3 必须用实测中文短指令对比 medium vs large-v3-turbo vs small**，若 turbo 全面更优可一行改推荐，不重开整份 SoT

### 6.2 Composer

- 同一 🎤；local listening：角标「本机转写」+ **秒数/剩余 cap** +「结束后识别」  
- processing：转圈；可取消；禁第二路 start  
- 无字级 interim（可「识别中…」状态，禁假 interim）  
- 320px：不新增长驻状态行（F-UX-B18）

### 6.3 Mic 矩阵

| 条件 | Mic |
|------|-----|
| voiceInputEnabled false | Hide |
| engine=browser 且无 SpeechRecognition | Hide |
| engine=local 且无 gUM/Media path | Hide local 能力 + 设置说明 |
| engine=local 且 Companion 断连 | Disable + banner |
| engine=local 且二进制/哈希失败 | Disable + banner |
| engine=local 且无就绪模型 | Disable + **banner**「请先在设置下载本机模型」+ 链到设置 |
| engine=browser | **不**要求 Companion（M1 零回归） |
| thread_busy | 禁 start |
| processing | 可 cancel；禁第二 start |
| local + offline | **仍可用**（与 browser 相反） |

### 6.4 手势与超时

| 项 | 值 |
|----|-----|
| 手势 | 点按 toggle |
| 收听 cap | **45s**（客户端 + **服务端**） |
| upload idle | 无 chunk **10s** → abort |
| 推理 cap | **90s**（超时人话错误） |
| auto-send | **无** |

### 6.5 本机错误表（用户可见中文；M1 实现前冻结文案数字）

| code | 用户文案方向 |
|------|----------------|
| empty_result | 未识别到内容，请重试 |
| model_missing | 本机模型未就绪，请先在设置下载 |
| binary_missing / hash_fail | 本机听写组件不可用，请更新 Companion |
| companion_disconnected | Companion 未连接，本机转写不可用（可改用浏览器听写） |
| session_busy | 正在识别，请稍候或取消 |
| payload_too_large | 录音过长或数据异常 |
| infer_timeout | 识别超时，请缩短后重试 |
| oom / resource_conflict | 本机资源不足（可关闭实验模型后重试） |
| aborted | （静默或轻提示，不污染草稿） |

---

## 7. 配置与数据所有权

| 项 | SoT |
|----|-----|
| voiceInputEnabled | `chrome.storage.local` |
| voice_privacy_ack_v2 | `chrome.storage.local` |
| sttEngine | **Companion** `config.voice.sttEngine` |
| localModelId | **Companion** `config.voice.localModelId` |
| 下载/就绪/进度 | Companion FS + state |
| **lastKnownEngine + lastKnownModelId** | 扩展 **持久镜像** 于 `chrome.storage.local`（防断连后未知引擎误走云） |

- 镜像规则：Companion `get_state` 成功后更新 lastKnown*；若 engine 镜像为 `local` 且 Companion 断连/未知 → mic **Disable**（fail-closed），**禁止** silent 当 browser 用  
- 从未选过 local（无 lastKnown / 默认 browser）→ M1 行为  
- `set_engine local` 时若模型未就绪 → **拒绝写配置**；设置页用 **UI draft** 先下载再提交（§6.1）

---

## 8. 协议（v1）

```text
voice.stt.start   E→C  { v:1, sessionId, modelId, format:"pcm_s16le"|"wav",
                         sampleRate:16000, channels:1, lang:"zh", maxMs:45000 }
voice.stt.chunk   E→C  { v:1, sessionId, seq, data:base64 }  // per-chunk cap
voice.stt.end     E→C  { v:1, sessionId, totalSeq }
voice.stt.abort   E→C  { v:1, sessionId }
voice.stt.partial C→E  { v:1, sessionId, status:"receiving"|"transcribing" }
voice.stt.result  C→E  { v:1, sessionId, text, ms, modelId }
voice.stt.error   C→E  { v:1, sessionId, code, message }

voice.model.get_state | download | cancel | delete | set_active | set_engine
  变更类：source:"settings" 双栏校验
```

**规则**：origin `chrome-extension://` only；session 绑定 ws；**全局 max-1**；epoch；晚到 no-op；聚合字节 cap（PCM 45s ≈1.44MB + slack，建议会话 ≤2.5MB raw）。

---

## 9. 模块边界（实现指引）

```text
extension: voice/local-stt-adapter + pcm-encode + 共用 session-reducer
companion/src/voice/: stt-session, whisper-runner, whisper-download,
                      whisper-handlers, binary-resolve, whisper-manifest
```

- **禁止**塞进 `computer.*` 命名空间  
- 下载 **复用 primitives**，**fork** whisper manifest family（非 TinyClick/Qwen schema）  
- **磁盘预算目录**必须 scoped 到 `models/whisper/`（或独立 root）；**禁止**对 `models/` 父树做与 Qwen 混算导致双计/互踩  
- tmp：`DATA_DIR/tmp/voice-stt/<id>`，文件 **0o600**、目录 **0o700**；全出口 unlink + boot GC  
- runner：`execFile` 固定二进制；model 路径服务端解析 allowlist

---

## 10. 资源

| 项 | 锁定 |
|----|------|
| 磁盘 | `voice.modelDiskBudgetMB` 默认 **4096**（独立于 Qwen）；UI 展示占用 |
| 下载 | 用户触发；无自动更新 |
| Qwen 共存 | 下载：预算；运行：Qwen loaded 时 **confirm** 再 STT |
| 推荐档 | **medium** |

---

## 11. 波次

| 波次 | 内容 | 门禁 |
|------|------|------|
| P0 | 本 SoT + 合成 + Path B ADR + **Pi 复审** | Pi ≠ REJECT |
| Spike | S0–S5 | **机器 PASS** 见 [spike-report](./2026-08-07-voice-local-stt-spike-report.md)；人工 S0–S2 PENDING |
| **M0** | manifest + download/cancel/delete/progress + get_state + 设置 UI | **已实现** 分支 `feat/voice-local-stt-m0`；完成注：[m0-COMPLETION](../plans/2026-08-07-voice-local-stt-m0-COMPLETION.md)；无 STT WS |
| **M1** | binary + runner + WS + adapter + processing + ack v2 + error map | **代码完成** 分支 `feat/voice-local-stt-m1`；[m1-COMPLETION](../plans/2026-08-07-voice-local-stt-m1-COMPLETION.md)；人工 e2e / dylib 打包仍待 |
| **M2** | 硬 RAM 互斥、GPU、流式 partial、质量表 | 另开对抗若动 auto-send/权限 |

---

## 12. 验收清单（M1）

**产品**

- [ ] 默认 browser；local 无自动下载  
- [ ] medium 主推；下载/删/取消  
- [ ] local 听写 → 草稿可编辑发送 ≥15 字中文  
- [ ] listening 计时；processing 可取消  
- [ ] 失败显式 CTA 切 browser + 云披露；无静默回落  
- [ ] browser 路径 M1 行为不回归  

**安全**

- [ ] ack v2 强制；Pack 不写 voice*  
- [ ] 无 audioCapture；日志无音频/全文  
- [ ] tmp 用后无残留（含 kill -9 后 boot GC 抽检）  
- [ ] settings-only 下载  

**平台**

- [ ] 无 ffmpeg；PCM 路径  
- [ ] binary SHA256 失败 → Disable  
- [ ] 断连 local Disable；offline local 仍可用  

---

## 13. 残余风险（不归零）

| ID | 残余 | 缓解 |
|----|------|------|
| R-B1 | 音频在 Companion 内存/WS | auth、短会话、不落日志 |
| R-B2 | tmp 磁盘直至 unlink | sandbox、GC |
| R-B3 | whisper 崩溃/CPU | 固定 binary、超时、max-1 |
| R-B4 | 权重供应链 | https+sha256+预算 |
| R-B5 | 引擎标签与真实路径不一致 | Companion SoT + fail closed |
| R-B6 | CTA 切 browser 隐私回退 | 强制披露句 |
| R-B7 | 与 Qwen 争内存 | confirm + 文案 |

---

## 14. 修订日志

| 日期 | 事件 |
|------|------|
| 2026-08-07 | Strawman（用户预决策：cpp / Ext WS / 三档 / 随包 binary） |
| 2026-08-07 | 四路对抗 MAJOR_REVISE ×4 |
| 2026-08-07 | 合成锁 SoT：prefs SoT、PCM、medium 主推、CTA+披露、预算、processing、spike 门 |
| 2026-08-07 | **Pi APPROVE_WITH_NITS** — 吸收：错误表、budget scope、UI draft 下载、CTA `source:settings`、lastKnown 镜像 fail-closed、banner 未就绪、tmp 0o600、S3 复核推荐档 |
| 2026-08-07 | **[ADR-023](../../adr/023-voice-local-stt-path-b.md)** Accepted — 决策/Trust/协议门禁锁定 |

---

*End SoT — ADR-023 + Pi nits absorbed; ready for spike + M0.*
