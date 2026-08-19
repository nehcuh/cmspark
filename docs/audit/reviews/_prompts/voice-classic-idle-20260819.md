# Brief — Classic local STT idle abort（≥10s 短听写必挂）

> **日期**: 2026-08-19  
> **Blast**: **T2**（L0 输入；动 session idle / max-1 时序，不抬 L2）  
> **确认序**: 三路独立对抗 → 合成 floors → TDD 实现 → 机核 → Pi 复审  
> **产品目标**: 经典本机听写录满 10–45s 仍能把 WAV 送进 Whisper，而不是被自己的 idle 掐死。

---

## 1. 已核验证据（实现会话 · 对抗须复读源码，勿只信摘要）

### 1.1 真机失败 `[executed]`

`~/.cmspark-agent/config.json`: `sttEngine=local`, `localModelId=large-v3-turbo`  
`companion-2026-08-19.log`:

| UTC | 事件 |
|-----|------|
| 07:56:09 | `voice.model.set_active` large-v3-turbo |
| 07:56:21.485 | `voice.stt.start.ok` format=**wav** lang=zh |
| 07:56:31.637 | `voice.stt.chunk.rejected` seq=0 **bytes=224684** |
| 07:56:31.638 | `voice.stt.end.rejected` |

间隔 **10.15s** = `STT_UPLOAD_IDLE_MS`（`companion/src/voice/session-caps.ts`）。  
224684 < `STT_MAX_CHUNK_BYTES`（256KiB）→ 不是块过大。`code` 被 logger redact。

### 1.2 代码合同 `[inspected]`

- `SttSessionService.start()` 立刻 `armIdleTimer()`；10s 无 chunk → `forceAbort()`。  
- **连续非流式**已修（Pi D1c blocker #2）：`local-stt-adapter.ts` ~732  
  `// Do NOT voice.stt.start until upload`  
  测：`voice-local-continuous.test.ts`「start is deferred until after record (idle-safe)」  
- **经典 `runClassic`** 仍：`beginCapture` → **立刻 `sendStart`** → 用户说完才 `uploadAndWait`。  
  测：`voice-local-stt-adapter-ws.test.ts` happy path **期望 start 发生在 stop 之前**（将被本修改正）。  
- 流式连续：F7 先开麦再 start，PCM 边录边 chunk（idle 可续上）。  
- large-v3-turbo 强制 `streamPartial=false` + 45s 窗 → 走经典/非流式 WAV，更容易踩 idle。

### 1.3 环境旁证（非本修范围）

- `~/.cmspark-agent/models/whisper/medium/` 仅 `.part`（未下完）  
- large 无渐进假设（`partial_skipped`）

---

## 2. Strawman（请攻击，勿当已锁）

**双修（纵深）**

| 层 | 改法 |
|----|------|
| **C1 客户端** | `runClassic` 对齐连续非流式：停录后再 `sendStart` + 立刻 `uploadAndWait`。`onStart` 仍在开麦成功后触发（UI 听写态不延后）。 |
| **S1 服务端** | `armIdleTimer()` **仅在第一块 chunk 成功写入后**才武装。`start()` 只武装 `recordTimer`（45s）。第一块之后 idle 仍 10s（真上传卡住仍掐）。 |

**明确非目标**

- 不改默认引擎、不改 large 推荐、不修 medium 残片下载、不动 browser Web Speech  
- 不 auto-send、不抬 L2、不放宽 origin / privacy_ack_v2 / max-1 / 字节 cap  
- 不把 idle 调成「永远不掐」；chunk 开始后 10s 静默仍 abort  
- 不在本批做 `network` 文案 / 默认切 medium

---

## 3. 请对抗路回答

1. Strawman 是否打到根因？有没有第二条根因被忽略？  
2. C1 / S1 是否都要？只做一侧是否够？哪侧是 floor？  
3. 安全：推迟 start 是否打开 max-1 竞态（听写录音中会议可抢槽）？idle 延后是否让死会话占槽更久？  
4. 诚实 UX：失败码 / banner 是否仍会撒谎？  
5. 回归：会议导入 `meeting-audio-import.ts`、连续流式、现有 idle 测、resource_conflict 重试。  
6. 必须有的失败测试（可观察 DoD）。  
7. 最后一行：`VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT`

**禁止**: 实现代码；只评计划 + 读现有源码。file:line。不要因为写得长就加分。
