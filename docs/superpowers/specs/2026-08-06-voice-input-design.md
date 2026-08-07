# 语音输入（Voice Input）— 产品设计 SoT

> **日期**: 2026-08-06  
> **状态**: **LOCKED for M0.5 spike / M1** — 四路对抗 floors 已吸收；**Pi 复审 APPROVE_WITH_NITS**（`voice-input-design-verdict-pi-20260806-194531`）  
> **对抗合成**: [voice-input-adversary-synthesis-20260806.md](../../audit/reviews/voice-input-adversary-synthesis-20260806.md)  
> **Pi 复审**: [voice-input-design-pi-20260806-194531.md](../../audit/reviews/voice-input-design-pi-20260806-194531.md)  
> **Strawman（已废）**: [2026-08-06-voice-input-design-strawman.md](2026-08-06-voice-input-design-strawman.md)  
> **ADR**: [020](../../adr/020-capability-model-three-axes.md) Surface L0 输入形态；不抬 L1/L2 / 不写 auto_approve*

---

## 0. 一句话（锁定）

**Side Panel 主线程 composer 可选「语音输入」：点按开始/结束，经 Chrome 语音识别得到文字写入草稿（默认可改再发）；转写可能使用浏览器云端语音服务，音频不经过 CMspark Companion；无自动发送、无常听唤醒、不是语音 Agent。**

---

## 1. 问题与 JTBD

| | |
|--|--|
| **谁** | 边看网页边指挥 Agent 的用户（中文为主） |
| **场景** | 短中文指令懒打、双手占用 |
| **成功（可验收）** | 授权后：说一段 ≥15 字中文 → 草稿可编辑 → 用现有发送发出；全程无 Companion 音频 |
| **非成功** | STT 质量超过系统听写；长文听写；免确认工具链 |

---

## 2. 目标 / 非目标

### 2.1 目标 M1

1. 主线程 composer 🎤（feature-detect 后）  
2. Web Speech → 草稿 only  
3. 首次：privacy ack（版本化）→ 权限 bootstrap → 再 `start()`  
4. 错误路径：拒权 / 空结果 / 网络 / 超时 / 不支持（见 §6.6 error map）  
5. Stop / chat.abort / 切线程 / 卸载 / 断连：立即停听写  
6. **失焦策略（Pi nit · 显式锁）**：M1 **Side Panel 失焦不停听写**（用户常瞟网页）；靠 45s 硬 cap + 显式 stop/mic toggle。M2 若改「失焦停」须单独立项（易误杀长指令）

### 2.2 非目标（锁定）

| 非目标 | 理由 |
|--------|------|
| TTS | 另一产品 |
| auto-send | 对抗：STT 误识 × 巡航 = 免点发送 |
| 唤醒词 / 始终听 | F-S8 |
| Companion / Whisper STT（Path B） | F-S7 原 v1 禁；**已由 [ADR-023](../../adr/023-voice-local-stt-path-b.md) + Path B SoT 开做**（独立对抗/Pi 后） |
| Worker / Cockpit / tray 🎤 | F-S9 |
| 语音绕过 L2 | 禁止 |
| `audioCapture` manifest | F-S5 / F-C6 |
| 转写进遥测 | F-S6 |

---

## 3. 方案

| 方案 | 状态 |
|------|------|
| **A Web Speech in Side Panel document** | **M1 唯一** |
| B Companion STT | 停车场；需新 ADR + 对抗 |
| C 仅文档推荐系统听写 | 始终可作为降级文案 |

**Tier-1**: Google Chrome desktop · macOS / Windows  
**Tier-2**: 其他 Chromium — Hide 或 best-effort  

---

## 4. ADR-020 声明

```text
Surface:      L0 输入 only
L2-classes:   (none) — voice never grants tools
Compose:      none
Autonomy:     n/a
Trust:        mic OS/Chrome + browser STT residual (may leave device);
              no auto_approve* writes; no voice_auto_send in v1
Channel:      community default = Web Speech (A)
```

---

## 5. 隐私：三通道模型（F-S1 · 强制用户可见）

| 通道 | 离开设备？ | 谁处理 |
|------|------------|--------|
| **Mic → STT** | **通常是**（Chrome 云端语音；本机包另论） | 浏览器厂商 STT，**非** CMspark 控制 |
| **文字 → Companion** | 仅用户点发送后 | 与键入相同：Companion + LLM |
| **CMspark 存储** | 仅消息文本 | threads/history；**无音频** |

**禁止文案**：单独「音频不经 Companion，因此隐私安全 / 完全本地 / 零风险」。

**允许一句话**（设置 + 首次 ack）：

> 可选麦克风：浏览器将语音转成文字后填入输入框，默认不自动发送。转写可能使用 Chrome 语音服务（音频可能经网络发送至浏览器厂商），**不经过** CMspark Companion。发送后的文字与键入相同，仍受现有确认与信任设置约束。

`voice_privacy_ack_v1` 存 `chrome.storage.local`；升 v2 时重 ack。

---

## 6. UX

### 6.1 布局（F-UX3）

默认 capsule（约 320px）：

```text
[attach] [ textarea ........ ] [mic] [send|stop]
```

- 图标 + `aria-label="语音输入"`（不用纯 emoji 当唯一 affordance）  
- Listening：mic 脉动；interim **仅**在 textarea 叠加或同框展示（二选一实现，禁止第三永久状态行）  
- 若宽度不足：**listening 时 hide attach**（morph），保证 send 可见  

### 6.2 交互（锁定）

| 项 | 值 |
|----|-----|
| 模式 | **点按 toggle** 开始/结束 |
| 最长单次 | **45s** 硬停 + 保留已 final 文本 |
| `continuous` | 会话内允许 interim；**禁止** `onend` 静默 restart |
| 空结果 | 文案「未识别到内容」；**永不**发送 |
| 默认语言 | `zh-CN`（M1 无语言选择 UI） |

### 6.3 ComposerMode 矩阵（F-UX1 · 对齐现网代码）

| Mode | 🎤 可见 | 可 start | 草稿 | 发送 |
|------|---------|----------|------|------|
| `ready` | 是* | 是 | 写入 textarea | 现有 `canSend` |
| `run_busy` | 是* | 是 | 写入 | 现有（通常可发） |
| `thread_busy` | 是* | **否**（tooltip：处理中无法听写） | — | 被 gate；右侧为 **停止** |
| `l2_task` | 是* | 是（填草稿） | 写入 | **硬拒**（去 Cockpit 文案不变） |

\* 前提：feature-detect 通过且 `voiceInputEnabled`。

**M1 不修改** `textarea disabled={threadBusy}` 合同：busy 时本就不能键入，听写也不开。

### 6.4 Stop / mic 三体（F-UX2 · F-I4）

| 用户动作 | 行为 |
|----------|------|
| Listening + 再点 mic | 结束听写 → merge draft；**不** chat.abort |
| Listening + 点 **停止**（threadBusy/streaming） | **先** abort recognition，**再** 现有 `chat.abort`；tooltip：「停止听写并停止本轮」 |
| 仅 idle + 停止 | 现有 abort only |
| 切线程 / 卸载 / 断连 | abort recognition；丢弃未提交 session |

### 6.5 子任务

**隐藏** 🎤（`thread.parent_thread_id` 非空）。

### 6.6 Engine error → 用户文案（F-C3 · Pi nit）

| Engine / 条件 | 用户可见 |
|---------------|----------|
| `not-allowed` / Permission denied | 无法使用麦克风：请在 Chrome 站点设置与系统隐私中允许本扩展 / Chrome |
| `no-speech` / 空 final | 未识别到内容 |
| `network` / 离线 | 语音识别需要网络（或本机语言包）；请检查网络后重试 |
| `aborted`（用户 Stop / 切线程） | 无 toast（静默回 idle） |
| 45s timeout | 已达单次听写上限，文字已保留在输入框 |
| API 不存在 | 不显示 🎤；设置中：当前浏览器不支持网页语音识别，可用系统听写 |

---

## 7. 权限与能力矩阵（F-C2 · F-C5）

### 7.1 Permission bootstrap（M1 门禁）

Side Panel 内首次 `start()` 在 Chromium 上常出现 **Permission dismissed 无弹窗**。

**锁定流程**：

1. 用户点 🎤  
2. 若无 `voice_privacy_ack_v1` → 展示隐私 sheet → 确认  
3. 查询 mic permission；若非 `granted` → **`chrome.tabs.create` 打开扩展内 `voice-permission.html`（或等价）** 完成授权  
4. 回 Side Panel 后再 `recognition.start()`  
5. `denied` → Disable mic + 文案：Chrome 站点设置 / macOS 系统设置 → 麦克风 → Google Chrome  

### 7.2 Hide vs Disable

| 条件 | UI |
|------|-----|
| `voiceInputEnabled === false` | **Hide** |
| 无 `SpeechRecognition` / `webkitSpeechRecognition` | **Hide**；设置中一句：可用系统听写 |
| 非 tier-1（可选策略） | **Hide** |
| 权限 `denied` | **Disable** + 原因 |
| 离线（`navigator.onLine === false`，云路径） | **Disable** 或 start 后 toast 网络 |
| 结构可用 | **Show enabled** |

---

## 8. 设置（`chrome.storage.local` only · F-I2）

| Key | Default | M1 |
|-----|---------|-----|
| `voiceInputEnabled` | `true` | 是 |
| `voice_privacy_ack_v1` | `false` | 是 |
| `voiceAutoSend` | — | **不出现** |
| `voiceLang` | 固定 zh-CN | 无 UI |

位置：设置 → 输入（邻「发送快捷键」）。  
**禁止**写入 Companion `config.json`。

---

## 9. 实现边界（F-I\*）

```text
sidepanel/voice/types.ts
sidepanel/voice/session-reducer.ts    # pure SM + unit tests
sidepanel/voice/text-merge.ts         # pure
sidepanel/voice/web-speech-adapter.ts
sidepanel/hooks/useVoiceInput.ts
sidepanel/components/VoiceMicButton.tsx
App.tsx InputArea —  thrin wire only
```

- 听写 ephemeral state **不进** `agentStore`  
- 发送 **只** 调现有 `handleSend`  
- 听写 start 时 **snapshot** `baseText`；final append；interim 不落盘  
- Companion / SW / bridge：**零改动**（除非 permission 页静态资源）  

### 状态机（摘要）

`unsupported | idle | starting | listening | stopping | error`  
Events: `USER_TOGGLE_*` · `CHAT_ABORT` · `THREAD_SWITCH` · `TIMEOUT` · `ENGINE_*`  
Invariant: 单实例 · `sessionId` · `committed` · abort 后不 merge 发送  

---

## 10. 残余风险（必须写进用户文档 · 非空）

| ID | 残余 | 缓解（不归零） |
|----|------|----------------|
| R1 | 浏览器云 STT 音频出站 | F-S1 披露 |
| R2 | 误识别错误意图 | 仅草稿；用户编辑 |
| R3 | （未来 auto-send × 巡航） | v1 删除 auto-send |
| R4 | 听写中环境音 | 手势 + 45s |
| R5 | 页面诱导用户口述危险指令 | 教育 + 草稿 |
| R6 | 口述密钥进聊天 | 与键入相同 |
| R7 | OS 多应用抢麦 | 系统模型 |
| R8 | 既有 auto_approve 域 | 语音不修复 |

---

## 11. 波次

| 波次 | 内容 | 门禁 |
|------|------|------|
| **M0** | 本 SoT + 对抗合成 + Pi 复审 | 完成 |
| **M0.5** | Platform spike：见 [m05-spike-report](2026-08-06-voice-input-m05-spike-report.md) | **机器 G1–G5 PASS**；人工 G7–G9 / Win **PENDING** — 功能默认开仍 blocked |
| **M1** | SM + mic + 草稿 + ack + 错误 + 设置开关 + 单测 | CI 绿；手动表 |
| **M1.1** | 可选 `input_modality: voice` 元数据 | 便宜则做 |
| **M2** | auto-send / lang UI / 按住 — **须重开对抗**；若做 auto-send 必须继承 **F-S2：巡航/三旗/值守/unattended 时强制关**（不可仅「默认 false」） | |
| **M3 / Path B** | 本机 STT — 见 [ADR-023](../../adr/023-voice-local-stt-path-b.md) · [Path B SoT](./2026-08-07-voice-local-stt-design.md) | Spike → M0 → M1 |

---

## 12. M1 验收清单

**Platform**

- [ ] Side Panel：`zh-CN` ≥1 次 `onresult`（Chrome tier-1）  
- [ ] Bootstrap 授权路径在 macOS + Windows 可完成首次 grant  
- [ ] 无 `audioCapture`  

**Trust / 隐私**

- [ ] 首次 ack 文案含云 STT；无「完全本地」  
- [ ] 网络层：无音频到 Companion WS  
- [ ] 无 auto-send UI  

**Composer**

- [ ] 矩阵 §6.3 与实现一致  
- [ ] Stop 停听写；切线程无串稿  
- [ ] 空结果不发送  
- [ ] Worker 无 🎤  

**质量**

- [ ] pure reducer 单测覆盖 abort / 空 final / timeout / 双 end  
- [ ] 手动：3 条中文短指令 + 1 条中英混排 API 名 → 编辑后发送  

---

## 13. 对抗与修订日志

| 日期 | 事件 |
|------|------|
| 2026-08-06 | Strawman |
| 2026-08-06 | 四路对抗：Product/Security **MAJOR_REVISE**；Platform/Impl **PASS_WITH_CHANGES** |
| 2026-08-06 | 合成锁 SoT：禁 auto-send、三通道隐私、bootstrap、主线程 only、≤45s、chrome.storage prefs |
| 2026-08-06 | **Pi 复审 APPROVE_WITH_NITS**；吸收：失焦不停、error map、M0.5 云 STT、M2 继承 F-S2 |
| 2026-08-06 | **M0.5 spike**：detect/error-map/tests/voice-spike tab + Chrome CDP probe；G1–G5 PASS；G7 onresult 待人工 |
| 2026-08-06 | **M1 实现**：session-reducer + adapter + useVoiceInput + mic 按钮 + 隐私 ack + permission tab + 设置；无 auto-send |
| 2026-08-06 | **Pi M1 R1 REJECT** → 修 ENGINE_END 不覆盖 error banner + prompt 走 bootstrap；**Pi R2 APPROVE_WITH_NITS** |

---

*End SoT — M1 + Pi R2 green; human G7 mic QA still recommended before marketing default-on.*
