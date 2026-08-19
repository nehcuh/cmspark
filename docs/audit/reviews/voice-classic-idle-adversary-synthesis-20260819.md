# 三路对抗合成 — Classic local STT idle abort

> **日期**: 2026-08-19  
> **Brief**: [`_prompts/voice-classic-idle-20260819.md`](_prompts/voice-classic-idle-20260819.md)  
> **Blast**: T2  
> **核验**: 三路均对照源码 `[inspected]`；真机日志 `[executed]`

---

## 参与路与裁决

| 路 | 角色 | 裁决 |
|----|------|------|
| **A** | Security / Trust / session | **REJECT**（拒绝 strawman 的 S1 / 双修） |
| **B** | Product / UX / Honesty | **APPROVE_WITH_NITS** |
| **C** | Correctness / tests | **APPROVE_WITH_NITS** |

### 合成裁决

**APPROVE_WITH_NITS · 只锁 C1；禁止 S1。**

产品目标（经典本机听写 ≥10s 不被 idle 掐死）三路均接受。  
Strawman「C1+S1 纵深」**不可按原文实现**：A 将 S1 判为 max-1 可用性回归（死会话从 10s 拉到 45s）；C 也写明若砍一侧必须砍 S1。

---

## 冲突决议

| 冲突 | 决议 |
|------|------|
| A 禁 S1 vs B/strawman 双修 | **只做 C1**。Idle 语义保持「上传卡住 10s」，不是「用户还在说话」。连续非流式 / 会议导入已经是 start-then-flush。 |
| C「S1 挡不住 45s recordTimer」 | 正因如此 **C1 是 floor**：停录且 WAV 就绪后再 `start`，idle 与 recordTimer 都杀不到录音窗。 |
| C1 推迟 start → 会议可抢槽 | **经典补连续已有的一次 `resource_conflict`/`session_busy` 重试**。不靠 S1 占槽 45s。UI XOR 保持。 |
| B 要求 `session_unknown` 诚实文案 | **本批 fold**：`session_unknown`（及同类 peer 失配）走本机 banner，**禁止**落到「未识别到内容」或裸码。 |

---

## 锁定 floors（本批）

1. **C1** `runClassic`：`onStart` 仍在 gUM 成功后；`voice.stt.start` **严格在** `capture.stop()` 之后，立刻 `chunk*`/`end`。  
2. **禁止 S1**：`start()` 仍 `armIdleTimer()`；现有「无 chunk → idle abort」测不得删。  
3. **经典一次冲突重试**（对齐 `runContinuous` 756–776）。  
4. **`session_unknown` 映射**为本机中文（会话已断开，请再试一次），加入 `LOCAL_STT_ERROR_CODES`。  
5. **测**：改写而非删除 happy-path；新增 classic idle-safe；冲突重试；error-map。不 sleep(10s)。  
6. **不改**：默认引擎/模型、medium 残片、browser `network` 文案、auto-send、origin/ack、会议导入同步 flush、流式 F7。

---

## 明确通过（勿回退）

- 连续非流式已 idle-safe（`local-stt-adapter.ts:732` + `voice-local-continuous.test.ts`）。  
- 会议 `transcribeWavViaStt` 已是同 tick start+chunk+end。  
- F-S-B6/B7 origin · ack · max-1 · 字节 cap · 无静默回云。

---

*合成者: Grok Build · 实现 agent 不得用本文件给自己 APPROVE。*
