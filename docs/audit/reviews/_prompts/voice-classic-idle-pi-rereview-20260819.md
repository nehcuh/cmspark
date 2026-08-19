# Pi 复审 — voice-classic-idle（C1 经典听写 idle abort）

你是 **Pi 复审**：确认或驳回已有对抗结论，不是从零发明一版设计。漏检 → REJECT。过严 nits 可降级。禁止只看摘要。

## 确认序材料（必须读）

1. 设计 brief：`docs/audit/reviews/_prompts/voice-classic-idle-20260819.md`
2. 三路合成（锁定 floors）：`docs/audit/reviews/voice-classic-idle-adversary-synthesis-20260819.md`
3. Eval gate card：`docs/audit/reviews/voice-classic-idle-eval-gate-20260819.md`
4. 实现 diff：对 **当前工作区** 跑 `git diff`（以 live 文件为准，旧 patch 可能过期）
5. Live 源码：
   - `chrome-extension/src/sidepanel/voice/local-stt-adapter.ts`（`runClassic` + `stop()`）
   - `chrome-extension/src/sidepanel/voice/error-map.ts`
   - `chrome-extension/src/sidepanel/voice/session-reducer.ts`
   - `companion/src/voice/stt-session-service.ts`（确认 **S1 未做**：`start()` 仍 `armIdleTimer()`）
   - 相关测：`chrome-extension/tests/voice-local-stt-adapter-ws.test.ts` 等

## 能力声明（实现侧）

```text
Surface:      L0 输入 only
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        本机 WAV → Companion whisper；不抬 confirm / auto_approve
Channel:      已鉴权 chrome-extension WS · 既有 voice.stt.*
```

## 机核（实现会话 `[executed]`）

```
cd chrome-extension && npx tsx --test tests/voice-*.test.ts
→ 96 pass, exit 0

cd chrome-extension && npx tsc --noEmit
→ exit 0
```

请 **自行再跑** 至少 `npx tsx --test tests/voice-local-stt-adapter-ws.test.ts tests/voice-local-error-map.test.ts tests/voice-session-reducer.test.ts`，把 exit code 写进报告。不要信实现者口头。

## 已锁定 floors（合成）

1. **C1 only**：经典 `voice.stt.start` 必须在 `capture.stop()` 之后，立刻 chunk/end；`onStart` 仍在 gUM 后。
2. **禁止 S1**：Companion `start()` 仍武装 10s idle；现有 idle 测不得删。
3. 经典一次 `resource_conflict` / `session_busy` → `-r1` 重试。
4. `session_unknown` 本机中文 banner，不得落到「未识别到内容」或裸码。
5. 测改写不删；无 sleep(10s)。
6. 非目标：默认引擎/模型、medium 残片、browser network 文案、会议导入、流式 F7。

## 实现对抗已折 nits

独立实现对抗 **APPROVE_WITH_NITS**（P1：retry 未看 `loopGen`，`abort()`→`reset()` 清掉 `aborted` 后 250ms 仍可能 `-r1`）。  
实现声称已用 `genAtStop !== loopGen` 折掉，并加测 `classic: abort during conflict backoff does not start -r1`。请 **核验是否真折干净**。

## 你的任务

1. 对照合成 floors 逐条 PASS/FAIL（file:line）。
2. 确认或驳回：设计对抗砍 S1 是否正确；C1 是否打到 10.15s 真机根因。
3. 查实现者过声称（测数、S1 未做、loopGen）。
4. ADR-020：无新工具/门/一级 UI 即可。
5. 漏检 blocker → REJECT。仅文档/测试缝可 AWN。

## 输出

Findings（P0/P1/P2）+ floor 表，最后一行必须是：

`VERDICT: APPROVE` 或 `VERDICT: APPROVE_WITH_NITS` 或 `VERDICT: REJECT`
