All verification complete. Here is my review report.

---

# Pi 复审 — voice-classic-idle

## 机核（自行执行，非转述）

| Check | Result |
|---|---|
| `npx tsx --test tests/voice-local-stt-adapter-ws.test.ts tests/voice-local-error-map.test.ts tests/voice-session-reducer.test.ts` | **27 pass · exit 0** |
| `npx tsx --test tests/voice-*.test.ts`（全量） | **96 pass · exit 0** |
| `npx tsc --noEmit` | **exit 0** |
| `companion/tests/voice-stt-session-service.test.ts`（S1 合同） | **16 pass · exit 0** |
| `git diff` 范围 | 仅 6 文件（3 src + 3 test），companion 零改动 |
| Patch 与 live 一致性 | `git apply --check -R` 通过，patch 与工作区一致 |

## Floors 对照表

| Floor | 判定 | 证据 |
|---|---|---|
| **1. C1**：`onStart` 仍在 gUM 后；`voice.stt.start` 严格在 `capture.stop()` 之后立刻 chunk/end | **PASS** | `local-stt-adapter.ts:445-450` `runClassic` 不再 `sendStart`，`onStart` 保留在 `beginCapture` 后；`stop()` 内 `handle.stop()` resolve 后 `sendStart` + `uploadAndWait`（chunks→end 同步紧接）`local-stt-adapter.ts:939-943`。测试断言 `iStart > iStop`、`iChunk > iStart`、`iEnd > iChunk`（ws 测试 116-178）；happy path 已改写为断言录音期间 **0 条** `voice.stt.start`（70-84）。 |
| **2. 禁止 S1**：Companion `start()` 仍 `armIdleTimer()`；idle 测未删 | **PASS** | `stt-session-service.ts:207` `start()` 无条件 `armIdleTimer()`；`git diff` companion 零改动；idle 测「idle timer force-aborts receiving session」`voice-stt-session-service.test.ts:400` 完好且通过。 |
| **3. 经典一次 `resource_conflict`/`session_busy` → `-r1` 重试** | **PASS** | `local-stt-adapter.ts:944-958`：abort 原 sid → 250ms → `-r1` 重试一次。测试 `classic: resource_conflict retries once with -r1 sessionId`（204-262）断言 `-r1` start 且不冒泡冲突错误。 |
| **4. `session_unknown` 本机中文 banner** | **PASS** | `error-map.ts:149-153` `session_unknown`/`peer_mismatch` → 「本机听写会话已断开，请再试一次」；`session-reducer.ts:30-31` 加入 `LOCAL_STT_ERROR_CODES`。reducer 测试（264-278）断言 ENGINE_END 后 banner 存活且无「未识别到内容」/裸码。`session_unknown` 确为 companion 真实码（`stt-session-core.ts:101/143/170/201/204`）。 |
| **5. 测改写不删；无 sleep(10s)** | **PASS** | happy path 改写非删除；测试最大 sleep 400ms（250ms backoff + 余量）。 |
| **6. 非目标不动** | **PASS** | diff 仅 6 文件；meeting 导入、连续流式、F7、browser 文案均未触碰。 |

## 关键核验

**① P1 折（实现对抗的 loopGen nit）— 真折干净**
`abort()` 在 `reset()` 前 `loopGen += 1`（`local-stt-adapter.ts` ~1000）；`reset()` 不碰 `loopGen`。重试条件 `genAtStop === loopGen`（946）与 backoff 后 `if (dead || genAtStop !== loopGen) return`（951）两道闸都看 `loopGen` 而非会被 `reset()` 清掉的 `aborted`。时序推演：冲突错误经 `queueMicrotask` 在 stop() 后立即送达 → 250ms backoff 在 ~21ms 就已武装 → 测试在 30ms 处 `abort()` 精确落在 backoff 窗内 → `genAtStop(1) !== loopGen(2)` → return，无 `-r1`。测试真实命中该窗口，非假阳性。✅

**② 设计对抗砍 S1 — 正确**
C1 是唯一 floor：start 推迟到停录后，idle（10s）与 recordTimer（45s）都只覆盖「立即上传」段，两者都杀不到录音窗。若做 S1（首块前不 arm idle），死会话从 10s 拉到 45s 占死 max-1 槽，且挡不住 45s recordTimer（合成路 C 已证），只做 S1 不解决根因。砍 S1 正确。

**③ C1 打到 10.15s 真机根因 — 是**
根因链：`start()`（07:56:21.485）武装 10s idle → 用户录 10.15s 零 chunk → `armIdleTimer` 到期 `forceAbort` → 停录后的 chunk（224684B，< 256KiB cap，非 payload_too_large）与 end 打到已死会话被拒。C1 消除了零 chunk 录音窗。旁证：`armIdleTimer` 在 `inferring` 时跳过（`stt-session-service.ts:663`）、`end()` 先 `clearTimersOnly`（355）—— idle 不会杀 infer，确认唯一凶手是录音窗。✅

**④ 实现者过声称**
- 96 pass / tsc 0：**属实**（本人重跑）。
- S1 未做：**属实**（companion 零 diff + idle 测通过）。
- loopGen 折：**属实**（上述①）。

## Findings

**P2-1**（`local-stt-adapter.ts:958-964`）：重试 `-r1` 的 `uploadAndWait` await 之后只有 `if (dead) return`，无 `aborted`/`genAtStop !== loopGen` 二次闸。若用户恰在重试 waiting 期 `abort()`，`finishPending` 使 continuation 继续 → 第二次 `onError("aborted")` + `onEnd()` + `reset()`（重复静默事件）。与首段 upload 的既有模式同源（旧代码已存在），reducer 终态与单次 abort 一致，无可见危害。P2。

**P2-2**：eval gate card 记「95 pass」，实际 96（新增 `abort during conflict backoff` 测后未更新卡片）。纯文档过期。

**P2-3**：`runClassic` 中 `capture = handle` 后的第二处 `if (dead || aborted)`（447-451）与前一处在同一同步段内，属冗余死检查。无害。

以上均非 blocker；无漏检项，无安全/信任回归（不抬 confirm/auto_approve、无新工具、无默认开启、`privacy_ack_v2` 保持）。

VERDICT: APPROVE_WITH_NITS
