# 聊天外部转写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 聊天听写可以改用 DeepSeek 原生 ASR 或 OpenAI 兼容音频转写，录音预算跟服务商上限走，失败不改回其它引擎。

**Architecture:** 地址、预算和 HTTP 都是 Companion 里的纯模块。扩展只采集 16 kHz WAV、按状态下发的上限停录，并把块交给现有 `voice.stt.*`。密钥不出 Companion。会议不调用这条 HTTP。

**Tech Stack:** Companion Node `node:test` + `tsc -p tsconfig.test.json` + `node scripts/run-tests.mjs`；扩展同样 `node:test`。不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-18-external-chat-asr-design.md`（GitHub #860，2026-11-18 批准）。

## Global Constraints

- 基线 `55f82f93434b4d1dc6edf69412b16cbbdf923434`。实现 PR 写 `Refs #860`，不关闭该票，直到行为合并。
- 本轮不改 `package.json` 版本、不打 tag、不发 Release、不改 CHANGELOG 的版本标题。
- 只做聊天输入。`browser` / `local` / `system` 的 45 秒、10 秒块间隔、90 秒推理、2_500_000 字节和侧栏 95 秒等待保持原样。
- 外部不读取 `STT_MAX_RECORD_MS`、`STT_MAX_SESSION_BYTES`、`STT_INFER_MAX_MS`、`LOCAL_STT_PENDING_TIMEOUT_MS` 来截断或拒绝。
- DeepSeek：`maxDurationMs` 最高 120000，`maxBytes` 最高 8388608。出厂即这两个数。
- `api.openai.com`：出厂 `maxBytes` 25000000，`maxDurationMs` 为 `null`。不能把体积调到 25000000 以上。
- 其它 OpenAI 兼容主机：出厂同样 25000000 与空时长，但 `limitNote` 是 `unprobed-local-default`。体积最高 33554432。这 32 MiB 是进程内存边界，保存超限必须可见拒绝，不得悄悄改小，也不得写成服务商上限或无限。
- 到点保留已录前缀，只 POST 一次。不自动切段。管道连续 15000 毫秒没有块：不 POST。
- `requestTimeoutMs` 出厂 180000，允许 30000 到 600000。600000 只是客户端整次 POST 的最长等待。DeepSeek 文档的 10 分钟只解释上传 HTTP 408。504 是识别超时。两者都映射 `external_timeout`，不重试。
- 本计划 Task 1–7 不改 `whisper-runner.ts` 的 `-ng`、预热或模型目录。本地优化只写在文末「后续本地识别优化」，不实施，也不在用户机器上测量。
- 不自动复用聊天 `base_url` 或 `api_key`。空密钥不能 `set_engine` 为 external，也不能 start。
- 保存配置不调用 `fetch`。没有「已连通」。
- 取消录音不上传。POST 开始后取消要 abort，并丢弃迟到正文。文案承认对方可能已经收到。
- 外部错误不改 `sttEngine`，不走 `autoFallbackToBrowser`，不自动重试。
- `asrRefinerEnabled` 默认仍是 false。只有为 true 且转写文字非空时才发 `voice.refine.request`，体里没有音频。
- 会议在 external 引擎下返回 `meeting_external_unsupported`，HTTP 次数为 0。
- 密钥只在 `config.json`（目录 `0o700`，文件 `0o600`）。下发为 `***` 或空。日志不写密钥、Authorization、音频或转写正文。这不是钥匙串，也不是加密。
- 每个节点独立对抗评审。FAIL 先改再评。节点 0 是本计划与 spec 的文档 PR。评审通过前不写节点 1 的产品代码。节点 3 才宣称同 SHA 的四条 workflow、十项检查。不放宽超时，不盲目重跑。

## 文件边界

| 文件 | 责任 |
|---|---|
| `companion/src/voice/external-asr-url.ts` | 风格、地址规范化、主机类别 |
| `companion/src/voice/external-asr-budget.ts` | 预算校验、到点截断、等待时间 |
| `companion/src/voice/external-asr-config.ts` | 保存与引擎切换的纯决定，密钥不进状态 |
| `companion/src/voice/external-asr-client.ts` | 一次 multipart POST、重定向失败、取消 |
| `companion/src/voice/external-asr-session.ts` | `voice.stt.*` 的 external 缓冲，不占用本机字节预算 |
| `companion/src/config.ts` | `VoiceExternalConfig` 与加载校验 |
| `companion/src/config-redact.ts` | `voice.external.apiKey` 脱敏 |
| `companion/src/voice/whisper-state.ts` | `voice.model.state` 增加 external 视图，无密钥 |
| `companion/src/voice/whisper-handlers.ts` | `voice.external.set` 与 `set_engine:"external"` |
| `companion/src/ws/validate.ts` | 新消息与 external start 不套 45 秒 |
| `companion/src/voice/stt-handlers.ts` | external 分支，不要求 local |
| `companion/src/meeting/meeting-handlers.ts` | 拒绝会议音频外发 |
| `chrome-extension/src/sidepanel/voice/external-asr-ui.ts` | 文案、语言标签、是否纠错 |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | 设置控件只调用上述纯函数与现有发送 |
| `chrome-extension/src/sidepanel/hooks/useVoiceInput.ts` | 停录、取消、纠错门，不把 external 送进浏览器回退 |

## 节点

| 节点 | 任务 | 通过之前禁止 |
|---|---|---|
| 0 | 本文件与已批准 spec 的文档 PR | 改产品代码 |
| 1 | Task 1–3 配置、地址、预算 | Task 4 |
| 2 | Task 4–6 会话、设置、取消 | Task 7 的全量宣称 |
| 3 | Task 7 指南与全量回归 | 合并、tag、Release |

合并不在本计划的执行者权限内。同 SHA 十项检查全绿之后，由主对话 fresh `gh` 与独立最终门禁合并。

---

### Task 1: 地址规范化

**Files:**

- Create: `companion/src/voice/external-asr-url.ts`
- Test: `companion/tests/voice-external-asr-url.test.ts`

**Interfaces:**

- Consumes: 无。
- Produces: `ExternalAsrStyle`、`ExternalLimitNote`、`canonicalExternalUrl(style, raw)`。

- [ ] **Step 1: Write the failing test**

`companion/tests/voice-external-asr-url.test.ts`

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { canonicalExternalUrl } from "../src/voice/external-asr-url"

test("deepseek empty, /v1, and full path share one URL", () => {
  for (const raw of ["", "https://api.deepseek.com/v1", "https://api.deepseek.com/v1/tools/asr"]) {
    const got = canonicalExternalUrl("deepseek", raw)
    assert.equal(got.ok, true)
    if (got.ok) {
      assert.equal(got.url, "https://api.deepseek.com/v1/tools/asr")
      assert.equal(got.limitNote, "deepseek-docs")
    }
  }
})

test("deepseek rejects chat path and doubled /v1", () => {
  for (const raw of ["https://api.deepseek.com/v1/v1", "https://api.deepseek.com/chat/completions"]) {
    assert.equal(canonicalExternalUrl("deepseek", raw).ok, false)
  }
})

test("openai default and custom prefix append transcriptions once", () => {
  const official = canonicalExternalUrl("openai", "")
  assert.equal(official.ok && official.url, "https://api.openai.com/v1/audio/transcriptions")
  assert.equal(official.ok && official.limitNote, "openai-file-cap")
  const custom = canonicalExternalUrl("openai", "https://example.test/openai/v1")
  assert.equal(custom.ok && custom.url, "https://example.test/openai/v1/audio/transcriptions")
  assert.equal(custom.ok && custom.limitNote, "unprobed-local-default")
  const twice = canonicalExternalUrl("openai", "https://api.openai.com/v1/audio/transcriptions")
  assert.equal(twice.ok && twice.url, "https://api.openai.com/v1/audio/transcriptions")
})

test("rejects userinfo, query, fragment, public http, and link-local", () => {
  const bad = [
    "https://user:pass@api.deepseek.com/v1/tools/asr",
    "https://api.deepseek.com/v1/tools/asr?x=1",
    "https://api.deepseek.com/v1/tools/asr#a",
    "http://example.test/v1",
    "http://169.254.169.254/v1/tools/asr",
    "file:///tmp/a",
  ]
  for (const raw of bad) assert.equal(canonicalExternalUrl("deepseek", raw).ok, false)
})

test("allows loopback and RFC1918 literals over http", () => {
  for (const raw of ["http://127.0.0.1:9000", "http://192.168.1.9:8080", "http://localhost:9"]) {
    assert.equal(canonicalExternalUrl("openai", raw).ok, true)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix companion exec -- tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/voice-external-asr-url.test.js`

工作目录是仓库根。Expected: FAIL，找不到 `../src/voice/external-asr-url` 或 `canonicalExternalUrl`。

- [ ] **Step 3: Write minimal implementation**

`canonicalExternalUrl` 只做字符串与 `URL` 解析，不调用 `fetch`、不调用 `dns`。`https` 的解析地址检查留在 Task 4 的发送前，因为保存必须零网络。链路本地字面 IP 在这一步就拒绝。`http` 只允许 `localhost`、`127.0.0.0/8`、`::1`、RFC1918 与 `fc00::/7`。deepseek 路径规则与 openai 追加规则按 spec 第 5.2 节，禁止生成 `/v1/v1`。

- [ ] **Step 4: Run test to verify it passes**

同一条命令。Expected: PASS，5 个测试，0 fail。

- [ ] **Step 5: Commit**

```bash
git add companion/src/voice/external-asr-url.ts companion/tests/voice-external-asr-url.test.ts
git commit -m "feat: canonicalize external ASR URLs without network"
```

节点 1 的提交可以先留在本地，等 Task 3 的评审一起推送。不要在 Task 1 打开新的 PR。

---

### Task 2: 预算与到点截断

**Files:**

- Create: `companion/src/voice/external-asr-budget.ts`
- Test: `companion/tests/voice-external-asr-budget.test.ts`

**Interfaces:**

- Consumes: `ExternalAsrStyle`、`ExternalLimitNote`，来自 `external-asr-url.ts`。
- Produces: `EXTERNAL_MEMORY_GUARD_BYTES = 33554432`，`validateExternalBudget`，`factoryExternalBudget`，`externalStopDecision`，`externalUiWaitMs`。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import test from "node:test"
import {
  externalStopDecision,
  externalUiWaitMs,
  factoryExternalBudget,
  validateExternalBudget,
} from "../src/voice/external-asr-budget"

test("deepseek factory is 120s and 8 MiB, and higher values fail closed", () => {
  const factory = factoryExternalBudget("deepseek", "deepseek-docs")
  assert.deepEqual(factory, { maxDurationMs: 120000, maxBytes: 8388608, requestTimeoutMs: 180000 })
  assert.equal(validateExternalBudget({ style: "deepseek", limitNote: "deepseek-docs", maxDurationMs: 120001, maxBytes: 8388608, requestTimeoutMs: 180000 }).ok, false)
  assert.equal(validateExternalBudget({ style: "deepseek", limitNote: "deepseek-docs", maxDurationMs: 120000, maxBytes: 8388609, requestTimeoutMs: 180000 }).ok, false)
})

test("openai official file cap has no duration, and 25MB is decimal", () => {
  const factory = factoryExternalBudget("openai", "openai-file-cap")
  assert.equal(factory.maxDurationMs, null)
  assert.equal(factory.maxBytes, 25000000)
  assert.equal(validateExternalBudget({ style: "openai", limitNote: "openai-file-cap", ...factory, maxBytes: 25000001 }).ok, false)
})

test("unprobed default is not a probed provider cap and cannot exceed the memory guard", () => {
  const factory = factoryExternalBudget("openai", "unprobed-local-default")
  assert.equal(factory.maxBytes, 25000000)
  assert.equal(factory.maxDurationMs, null)
  assert.equal(validateExternalBudget({ style: "openai", limitNote: "unprobed-local-default", maxDurationMs: null, maxBytes: 33554432, requestTimeoutMs: 180000 }).ok, true)
  assert.equal(validateExternalBudget({ style: "openai", limitNote: "unprobed-local-default", maxDurationMs: null, maxBytes: 33554433, requestTimeoutMs: 180000 }).ok, false)
})

test("already over maxBytes is trimmed to the aligned cap", () => {
  const stop = externalStopDecision({
    committedWavBytes: 25000001,
    candidatePcmBytes: 100,
    maxDurationMs: null,
    maxBytes: 25000000,
  })
  assert.equal(stop.reason, "bytes")
  assert.equal(stop.keepBytes, 25000000)
  assert.ok(stop.keepBytes <= 25000000)
})

test("one chunk that crosses duration and size keeps the tighter aligned prefix", () => {
  const stop = externalStopDecision({
    committedWavBytes: 44,
    candidatePcmBytes: 100000,
    maxDurationMs: 1000,
    maxBytes: 32100,
  })
  assert.equal(stop.reason, "both")
  assert.equal(stop.keepBytes, 32044)
  assert.ok(stop.keepBytes <= 32100)
  assert.equal((stop.keepBytes - 44) % 2, 0)
})

test("odd size cap keeps an even PCM payload", () => {
  const stop = externalStopDecision({
    committedWavBytes: 44,
    candidatePcmBytes: 5,
    maxDurationMs: null,
    maxBytes: 47,
  })
  assert.equal(stop.reason, "bytes")
  assert.equal(stop.keepBytes, 46)
})

test("120s wav is inside the DeepSeek caps and is not the old 2500000 session limit", () => {
  const wav = 44 + 120 * 32000
  assert.equal(wav, 3840044)
  assert.ok(wav > 2500000)
  const held = externalStopDecision({
    committedWavBytes: wav,
    candidatePcmBytes: 0,
    maxDurationMs: 120000,
    maxBytes: 8388608,
  })
  assert.equal(held.reason, "none")
  assert.equal(held.keepBytes, 3840044)
  const next = externalStopDecision({
    committedWavBytes: wav,
    candidatePcmBytes: 2,
    maxDurationMs: 120000,
    maxBytes: 8388608,
  })
  assert.equal(next.reason, "duration")
  assert.equal(next.keepBytes, 3840044)
})

test("25MB and 32MiB boundaries do not grow past the cap", () => {
  for (const maxBytes of [25000000, 33554432]) {
    const stop = externalStopDecision({
      committedWavBytes: maxBytes,
      candidatePcmBytes: 2,
      maxDurationMs: null,
      maxBytes,
    })
    assert.equal(stop.reason, "bytes")
    assert.ok(stop.keepBytes <= maxBytes)
    assert.equal((stop.keepBytes - 44) % 2, 0)
  }
})

test("ui wait is the request timeout plus 10s", () => {
  assert.equal(externalUiWaitMs(180000), 190000)
  assert.equal(validateExternalBudget({ style: "deepseek", limitNote: "deepseek-docs", maxDurationMs: 120000, maxBytes: 8388608, requestTimeoutMs: 29999 }).ok, false)
  assert.equal(validateExternalBudget({ style: "openai", limitNote: "unprobed-local-default", maxDurationMs: null, maxBytes: 25000000, requestTimeoutMs: 600001 }).ok, false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix companion exec -- tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/voice-external-asr-budget.test.js`

Expected: FAIL，模块不存在。

- [ ] **Step 3: Write minimal implementation**

`externalStopDecision` 的入参是 `committedWavBytes`、`candidatePcmBytes`、`maxDurationMs | null`、`maxBytes`。没有 `elapsedMs`，也不把当前 `wavBytes` 原样当成 `keepBytes`。16-bit 单声道按 2 字节对齐，头是 44。时长上限的 PCM 字节是 `floor(ms * 16000 / 1000) * 2`。体积上限的 PCM 字节是 `max(0, maxBytes - 44)` 再去掉余数。生效 PCM 上限取更小的那个。已提交 PCM 超过它就裁回；候选块只收下还空着的对齐字节。候选同时越过两道线时 `reason` 为 `"both"`。不要调用 `STT_MAX_SESSION_BYTES`。`validateExternalBudget` 失败时不改传入对象。

- [ ] **Step 4: Run test to verify it passes**

同一命令。Expected: PASS，0 fail。文件里的测试个数以源码为准，不把旧的 6 个当成上限。

- [ ] **Step 5: Commit**

```bash
git add companion/src/voice/external-asr-budget.ts companion/tests/voice-external-asr-budget.test.ts
git commit -m "feat: keep external ASR budgets off the local 45s cap"
```

---

### Task 3: 配置、脱敏与引擎开关

**Files:**

- Create: `companion/src/voice/external-asr-config.ts`
- Modify: `companion/src/config.ts` 的 `VoiceConfig` 与 `defaultConfig.voice`
- Modify: `companion/src/config-redact.ts`
- Modify: `companion/src/voice/whisper-state.ts`
- Modify: `companion/src/voice/whisper-handlers.ts`
- Modify: `companion/src/ws/validate.ts`
- Test: `companion/tests/voice-external-asr-config.test.ts`

**Interfaces:**

- Consumes: `canonicalExternalUrl`、`validateExternalBudget`、`factoryExternalBudget`。
- Produces: `reduceExternalConfig(current, action)` 与 `externalStateView(config)`。处理器只调用它们。`VoiceExternalConfig` 字段与 spec 第 5.1 节同名。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { externalStateView, reduceExternalConfig } from "../src/voice/external-asr-config"

const stored = {
  sttEngine: "browser" as const,
  external: {
    style: "deepseek" as const,
    baseUrl: "",
    model: "whisper-1",
    apiKey: "stored-secret",
    maxDurationMs: 120000,
    maxBytes: 8388608,
    requestTimeoutMs: 180000,
  },
}

test("masked key keeps the stored secret and blank key clears it", () => {
  const kept = reduceExternalConfig(stored, { type: "set", apiKey: "***" })
  assert.equal(kept.ok && kept.external.apiKey, "stored-secret")
  const cleared = reduceExternalConfig(stored, { type: "set", apiKey: "" })
  assert.equal(cleared.ok && cleared.external.apiKey, "")
})

test("bad url and empty key do not switch the engine", () => {
  const bad = reduceExternalConfig(stored, { type: "set", baseUrl: "http://example.test/v1" })
  assert.equal(bad.ok, false)
  assert.equal(bad.ok === false && bad.sttEngine, "browser")
  const engine = reduceExternalConfig({ ...stored, external: { ...stored.external, apiKey: "" } }, {
    type: "set-engine",
    engine: "external",
    privacyAckExternalV1: true,
  })
  assert.equal(engine.ok, false)
})

test("state view has no apiKey field", () => {
  const view = externalStateView(stored)
  assert.equal(view.keyConfigured, true)
  assert.equal("apiKey" in view, false)
})

test("style change without a budget uses the new factory values", () => {
  const next = reduceExternalConfig(stored, { type: "set", style: "openai", baseUrl: "" })
  assert.equal(next.ok && next.external.maxDurationMs, null)
  assert.equal(next.ok && next.external.maxBytes, 25000000)
  assert.equal(next.ok && next.sttEngine, "browser")
})
```

同一文件再写校验和水合。`validateWsMessage` 来自 `../src/ws/validate`。配置用动态 `import("../src/config")`，在调用前把 `CMSPARK_DATA_DIR` 指到临时目录并 `clearConfigCache()`，不读开发者家里的 `config.json`。

```ts
import { validateWsMessage } from "../src/ws/validate"
import { redactConfigForWire } from "../src/config-redact"

const externalStart = {
  type: "voice.stt.start",
  v: 1,
  sessionId: "s",
  format: "wav",
  sampleRate: 16000,
  channels: 1,
  engine: "external",
  privacy_ack_external_v1: true,
}

test("external start skips the whisper model id and the 45s maxMs cap", () => {
  assert.equal(validateWsMessage(externalStart).valid, true)
  assert.equal(validateWsMessage({ ...externalStart, maxMs: 120000 }).valid, true)
  assert.equal(validateWsMessage({ ...externalStart, privacy_ack_external_v1: undefined, privacy_ack_v2: true }).valid, false)
  assert.equal(validateWsMessage({ type: "voice.model.set_engine", source: "settings", engine: "external" }).valid, true)
})

test("local and system validation stays on the old rules", () => {
  const local = {
    type: "voice.stt.start",
    v: 1,
    sessionId: "s",
    format: "wav",
    sampleRate: 16000,
    channels: 1,
    modelId: "medium",
    privacy_ack_v2: true,
    maxMs: 45000,
  }
  assert.equal(validateWsMessage(local).valid, true)
  assert.equal(validateWsMessage({ ...local, maxMs: 45001 }).valid, false)
  assert.equal(validateWsMessage({ ...local, modelId: undefined }).valid, false)
  assert.equal(validateWsMessage({ ...local, engine: "system", modelId: undefined, privacy_ack_v2: true }).valid, true)
})

test("wire redaction masks the external key", () => {
  const red = redactConfigForWire({ voice: { external: { apiKey: "stored-secret" } } })
  assert.equal(red.voice.external.apiKey, "***")
})

test("reload keeps external and only fills a missing external object", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-external-asr-"))
  process.env.CMSPARK_DATA_DIR = dir
  const cfg = await import("../src/config")
  cfg.clearConfigCache()
  await cfg.initDataDir()
  const file = path.join(dir, "config.json")
  const disk = JSON.parse(fs.readFileSync(file, "utf8"))
  disk.voice = { sttEngine: "browser", localModelId: "medium", modelDiskBudgetMB: 4096 }
  fs.writeFileSync(file, JSON.stringify(disk))
  cfg.clearConfigCache()
  const browser = cfg.getConfig()
  assert.equal(browser.voice.sttEngine, "browser")
  assert.equal(browser.voice.external.maxDurationMs, 120000)
  disk.voice.sttEngine = "external"
  disk.voice.external = browser.voice.external
  fs.writeFileSync(file, JSON.stringify(disk))
  cfg.clearConfigCache()
  assert.equal(cfg.getConfig().voice.sttEngine, "external")
})
```

文件顶部补上 `fs`、`os`、`path` 的 import。`initDataDir` 会写出默认配置；测试再改 `voice` 后清缓存重读。今天 `config.ts` 1073–1079 行会把未知的 `"external"` 改回 browser，所以上面最后一条现在必须失败。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix companion exec -- tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/voice-external-asr-config.test.js`

Expected: FAIL，类型或消息还不存在。

- [ ] **Step 3: Write minimal implementation**

`reduceExternalConfig` 与 `externalStateView` 先写成纯函数，处理器只调用它们。`voice.external.set` 失败时不调用 `setVoiceFields`。`set_engine` 的 external 分支在写入前检查密钥非空、地址合法、`privacy_ack_external_v1 === true`。`privacy_ack_v2` 不能代替它。`validate.ts` 716–717 行今天拒绝除 `"system"` 以外的 `engine`；external 要成为合法值，且不要求 Whisper `modelId`。738–740 行的 `maxMs <= 45000` 只继续约束没有 `engine: "external"` 的 start。742 行的 `privacy_ack_v2` 只继续约束 local 与 system。`config.ts` 1073–1079 行把未知引擎改回 browser；`"external"` 必须留在合法枚举里。旧文件没有 `voice.external` 时只补默认对象，`sttEngine` 仍是原来的 browser、local 或 system。

- [ ] **Step 4: Run test to verify it passes**

同一命令，再加上 `node scripts/run-tests.mjs .test-dist/tests/voice-config.test.js .test-dist/tests/voice-whisper-handlers.test.js`。Expected: 新测试 PASS，原语音配置测试仍然 PASS。

- [ ] **Step 5: Commit**

```bash
git add companion/src/voice/external-asr-config.ts companion/src/config.ts companion/src/config-redact.ts companion/src/voice/whisper-state.ts companion/src/voice/whisper-handlers.ts companion/src/ws/validate.ts companion/tests/voice-external-asr-config.test.ts
git commit -m "feat: store external ASR settings apart from the chat key"
```

**节点 1 门禁：** 独立评审 Task 1–3。FAIL 则停在本节点。PASS 之前不开始 Task 4。

---

### Task 4: 一次 HTTP 转写

**Files:**

- Create: `companion/src/voice/external-asr-client.ts`
- Test: `companion/tests/voice-external-asr-client.test.ts`

**Interfaces:**

- Consumes: `ExternalAsrStyle`。
- Produces: `transcribeExternal(req)`。`req` 的字段是 `style: "deepseek" | "openai"`、`url: string`、`apiKey: string`、`wav: Uint8Array`、`model?: string`、`language?: string`、`timeoutMs: number`、`signal: AbortSignal`、`fetchImpl`。`fetchImpl` 的第二个参数含 `method: "POST"`、`redirect: "error"`、`headers`、`body: FormData`、`signal`。

- [ ] **Step 1: Write the failing test**

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { transcribeExternal } from "../src/voice/external-asr-client"

const wav = Uint8Array.of(1, 2, 3, 4)

function formOf(body: FormData) {
  return {
    file: body.get("file"),
    model: body.get("model"),
    language: body.get("language"),
    response_format: body.get("response_format"),
    stream: body.get("stream"),
    prompt: body.get("prompt"),
  }
}

test("deepseek sends only file and openai sends model, file, language, json", async () => {
  const seen: Array<{ url: string; redirect: string; auth: string; fields: ReturnType<typeof formOf> }> = []
  const fetchImpl = async (url: string, init: { redirect: string; headers: Record<string, string>; body: FormData }) => {
    seen.push({ url, redirect: init.redirect, auth: init.headers.Authorization, fields: formOf(init.body) })
    return { status: 200, json: async () => ({ text: "你好" }) }
  }
  const deep = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal, fetchImpl,
  })
  assert.equal(deep.ok && deep.text, "你好")
  assert.equal(seen[0].redirect, "error")
  assert.equal(seen[0].auth, "Bearer secret")
  assert.equal(seen[0].fields.model, null)
  assert.equal(seen[0].fields.language, null)
  const open = await transcribeExternal({
    style: "openai", url: "https://api.openai.com/v1/audio/transcriptions", apiKey: "secret",
    wav, model: "whisper-1", language: "zh", timeoutMs: 180000, signal: new AbortController().signal, fetchImpl,
  })
  assert.equal(open.ok, true)
  assert.equal(seen[1].fields.model, "whisper-1")
  assert.equal(seen[1].fields.language, "zh")
  assert.equal(seen[1].fields.response_format, "json")
  assert.equal(seen[1].fields.stream, null)
  assert.equal(seen[1].fields.prompt, null)
  assert.equal(JSON.stringify(seen).includes("secret") && seen[0].auth === "Bearer secret", true)
})

test("redirect is not followed", async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return { status: 302, json: async () => ({ text: "no" }) }
  }
  const got = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal, fetchImpl,
  })
  assert.equal(calls, 1)
  assert.equal(got.ok, false)
  assert.equal(!got.ok && got.code, "external_redirect")
})

test("abort before fetch sends nothing, and a late body is ignored", async () => {
  let calls = 0
  const early = new AbortController()
  early.abort()
  const fetchImpl = async () => {
    calls += 1
    return { status: 200, json: async () => ({ text: "late" }) }
  }
  const skipped = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: early.signal, fetchImpl,
  })
  assert.equal(calls, 0)
  assert.equal(!skipped.ok && skipped.code, "aborted")
  const live = new AbortController()
  const pending = transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: live.signal,
    fetchImpl: (_url, init) => new Promise((resolve) => {
      calls += 1
      init.signal.addEventListener("abort", () => resolve({ status: 200, json: async () => ({ text: "late" }) }))
    }),
  })
  live.abort()
  const late = await pending
  assert.equal(!late.ok && late.code, "aborted")
})

test("non-json and empty text are not transcripts", async () => {
  const bad = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal,
    fetchImpl: async () => ({ status: 200, json: async () => { throw new Error("html") } }),
  })
  assert.equal(!bad.ok && bad.code, "external_bad_response")
  const empty = await transcribeExternal({
    style: "deepseek", url: "https://api.deepseek.com/v1/tools/asr", apiKey: "secret",
    wav, timeoutMs: 180000, signal: new AbortController().signal,
    fetchImpl: async () => ({ status: 200, json: async () => ({ text: "" }) }),
  })
  assert.equal(!empty.ok && empty.code, "external_empty")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix companion exec -- tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/voice-external-asr-client.test.js`

Expected: FAIL，函数不存在。

- [ ] **Step 3: Write minimal implementation**

`fetchImpl` 默认是全局 `fetch`，但测试必须注入。`redirect: "error"`。超时用 `AbortSignal.any` 组合调用方信号与 `AbortSignal.timeout(timeoutMs)`。解析 JSON 前若信号已 abort，直接返回 `aborted`。不要读取 `config.llm`。

- [ ] **Step 4: Run test to verify it passes**

同一命令。Expected: PASS，0 fail。

- [ ] **Step 5: Commit**

```bash
git add companion/src/voice/external-asr-client.ts companion/tests/voice-external-asr-client.test.ts
git commit -m "feat: post one external ASR request and drop late text"
```

---

### Task 5: 外部会话与会议拒绝

**Files:**

- Create: `companion/src/voice/external-asr-session.ts`
- Modify: `companion/src/voice/stt-handlers.ts`
- Modify: `companion/src/meeting/meeting-handlers.ts`
- Test: `companion/tests/voice-external-asr-session.test.ts`
- Create: `companion/src/voice/external-asr-meeting.ts`
- Test: `companion/tests/voice-stt-handlers.test.ts` 只加 external 用例，不改原断言
- Test: `companion/tests/voice-external-asr-meeting.test.ts`

**Interfaces:**

- Consumes: `transcribeExternal`、`externalStopDecision`、已保存的 `voice.external`。
- Produces: `createExternalAsrSession(deps)` 与 `meetingExternalRefusal(sttEngine)`。`deps` 是 `{ now: () => number; fetchImpl; config: () => { sttEngine: string; external: VoiceExternalConfig } }`。会话方法是 `start`、`chunk`、`end`、`abort`、`partialRequest`。chunk 的 `pcm` 是 `Uint8Array`。`meeting-handlers.ts` 在创建会议 PCM 之前调用 `meetingExternalRefusal`，返回值非空就用该码结束，不发 HTTP。

- [ ] **Step 1: Write the failing test**

`companion/tests/voice-external-asr-session.test.ts` 与 `companion/tests/voice-external-asr-meeting.test.ts` 都要先写成下面的源码。命令只跑这两个固定路径。

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { createExternalAsrSession } from "../src/voice/external-asr-session"

const external = {
  style: "deepseek" as const,
  baseUrl: "",
  model: "whisper-1",
  apiKey: "secret",
  maxDurationMs: 120000,
  maxBytes: 8388608,
  requestTimeoutMs: 180000,
}

function session(fetchImpl: (...args: any[]) => any, now: () => number) {
  return createExternalAsrSession({
    now,
    fetchImpl,
    config: () => ({ sttEngine: "external", external }),
  })
}

test("abort before end does not fetch", async () => {
  let calls = 0
  const s = session(async () => { calls += 1; return { status: 200, json: async () => ({ text: "x" }) } }, () => 0)
  assert.equal(s.start({ sessionId: "s", privacyAckExternalV1: true }).ok, true)
  s.chunk({ sessionId: "s", seq: 0, pcm: Uint8Array.of(0, 0) })
  const aborted = s.abort("s")
  assert.equal(aborted.sent, false)
  assert.equal(calls, 0)
})

test("15000ms without a chunk does not upload", async () => {
  let calls = 0
  let t = 0
  const s = session(async () => { calls += 1; return { status: 200, json: async () => ({ text: "x" }) } }, () => t)
  s.start({ sessionId: "s", privacyAckExternalV1: true })
  s.chunk({ sessionId: "s", seq: 0, pcm: Uint8Array.of(0, 0) })
  t = 15000
  const ended = await s.end("s")
  assert.equal(ended.sent, false)
  assert.equal(calls, 0)
})

test("3840044 bytes are accepted and posted once", async () => {
  let calls = 0
  let posted = 0
  const s = session(async (_url: string, init: { body: FormData }) => {
    calls += 1
    const file = init.body.get("file") as Blob
    posted = file.size
    return { status: 200, json: async () => ({ text: "好" }) }
  }, () => 0)
  s.start({ sessionId: "s", privacyAckExternalV1: true })
  const pcm = 120 * 32000
  const chunk = 256 * 1024
  let seq = 0
  for (let off = 0; off < pcm; off += chunk) {
    const n = Math.min(chunk, pcm - off)
    const part = s.chunk({ sessionId: "s", seq, pcm: new Uint8Array(n) })
    assert.equal(part.ok, true)
    assert.ok(n <= chunk)
    seq += 1
  }
  const ended = await s.end("s")
  assert.equal(calls, 1)
  assert.equal(posted, 44 + pcm)
  assert.equal(posted, 3840044)
  assert.equal(ended.ok && ended.text, "好")
})

test("chunks assemble more than 10MiB without one websocket payload", async () => {
  let calls = 0
  let posted = 0
  const wide = { ...external, maxBytes: 33554432, maxDurationMs: null }
  const s = createExternalAsrSession({
    now: () => 0,
    config: () => ({ sttEngine: "external", external: wide }),
    fetchImpl: async (_url: string, init: { body: FormData }) => {
      calls += 1
      posted = (init.body.get("file") as Blob).size
      return { status: 200, json: async () => ({ text: "长" }) }
    },
  })
  s.start({ sessionId: "s", privacyAckExternalV1: true })
  const chunk = 256 * 1024
  const total = 10 * 1024 * 1024 + chunk
  let seq = 0
  for (let off = 0; off < total; off += chunk) {
    const part = s.chunk({ sessionId: "s", seq, pcm: new Uint8Array(chunk) })
    assert.equal(part.ok, true)
    seq += 1
  }
  assert.ok(seq > 1)
  assert.equal((await s.end("s")).ok, true)
  assert.equal(calls, 1)
  assert.equal(posted, 44 + total)
  assert.ok(posted > 10 * 1024 * 1024)
  s.start({ sessionId: "next", privacyAckExternalV1: true })
  const tooBig = s.chunk({ sessionId: "next", seq: 0, pcm: new Uint8Array(chunk + 1) })
  assert.equal(tooBig.ok, false)
  assert.equal(calls, 1)
})

test("abort during post drops late text, and partialRequest does not fetch", async () => {
  let calls = 0
  const s = createExternalAsrSession({
    now: () => 0,
    config: () => ({ sttEngine: "external", external }),
    fetchImpl: (_url: string, init: { signal: AbortSignal }) => new Promise((resolve) => {
      calls += 1
      init.signal.addEventListener("abort", () => resolve({ status: 200, json: async () => ({ text: "late" }) }))
    }),
  })
  s.start({ sessionId: "s", privacyAckExternalV1: true })
  s.chunk({ sessionId: "s", seq: 0, pcm: Uint8Array.of(0, 0) })
  const pending = s.end("s")
  s.abort("s")
  const ended = await pending
  assert.equal(ended.ok, false)
  assert.equal(ended.code, "aborted")
  assert.notEqual(ended.text, "late")
  calls = 0
  const s2 = session(async () => { calls += 1; return { status: 200, json: async () => ({ text: "x" }) } }, () => 0)
  s2.start({ sessionId: "p", privacyAckExternalV1: true })
  assert.equal(s2.partialRequest("p").fetched, false)
  assert.equal(calls, 0)
})
```

`abort` 必须中止同一次 `end` 传给 `fetchImpl` 的 `signal`。测试不调用真实网络。

`companion/tests/voice-external-asr-meeting.test.ts`

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { meetingExternalRefusal } from "../src/voice/external-asr-meeting"

test("meeting audio is not sent when the engine is external", () => {
  assert.deepEqual(meetingExternalRefusal("external"), { code: "meeting_external_unsupported" })
  assert.equal(meetingExternalRefusal("local"), null)
  assert.equal(meetingExternalRefusal("system"), null)
  assert.equal(meetingExternalRefusal("browser"), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix companion exec -- tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/voice-external-asr-session.test.js .test-dist/tests/voice-external-asr-meeting.test.js`

Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

`stt-handlers.ts` 在 local 判断之前把 external 的 chunk、end、abort 交给 `createExternalAsrSession`，不调用 `stt-session-core.ts` 的 `appendChunk`。已保存引擎不是 external 时返回 `external_unconfigured`，不改配置。不要因为 `sttEngine !== "local"` 把 external 打成 `engine_not_local`。`meeting-handlers.ts` 创建 PCM 之前调用 `meetingExternalRefusal`；非空就返回该码，HTTP 次数为 0。一块 PCM 大于 256 KiB 时会话拒绝，且不把整段 WAV 放进一条 WebSocket 消息。

- [ ] **Step 4: Run test to verify it passes**

上述命令，再跑 `.test-dist/tests/voice-stt-handlers.test.js`。Expected: 新断言 PASS，原 start/chunk/end 断言仍 PASS。

- [ ] **Step 5: Commit**

```bash
git add companion/src/voice/external-asr-session.ts companion/src/voice/external-asr-meeting.ts companion/src/voice/stt-handlers.ts companion/src/meeting/meeting-handlers.ts companion/tests/voice-external-asr-session.test.ts companion/tests/voice-external-asr-meeting.test.ts companion/tests/voice-stt-handlers.test.ts
git commit -m "feat: transcribe chat audio externally without touching meetings"
```

---

### Task 6: 设置文案、停录与纠错门

**Files:**

- Create: `chrome-extension/src/sidepanel/voice/external-asr-ui.ts`
- Modify: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx`
- Modify: `chrome-extension/src/sidepanel/hooks/useVoiceInput.ts`
- Modify: `chrome-extension/src/sidepanel/types.ts` 与 `agentStore.tsx` 里的 `sttEngine` 联合类型
- Test: `chrome-extension/tests/voice-external-asr-ui.test.ts`
- Test: `chrome-extension/tests/voice-fallback.test.ts` 增加一条 external 不回退

**Interfaces:**

- Consumes: 状态里的 `external.limitNote`、`maxDurationMs`、`maxBytes`、`requestTimeoutMs`、`keyConfigured`。
- Produces: `externalLimitCopy`、`externalPrivacyCopy`、`externalCancelCopy`、`externalLanguageTag`、`externalShouldRefine`。`externalCapCopy` 仍按时长或体积返回第 6 节的两句到点文案。

文案固定为：

- `deepseek-docs`：「DeepSeek 官方上限是 120 秒和 8 MiB。到点后转写已录的这一段。」
- `openai-file-cap`：「OpenAI 文档写的是文件最大 25 MB，没有写统一时长。这不是对账号的探测。」
- `unprobed-local-default`：「这是本机停止线，不是探测到的服务商上限。32 MiB 是本程序能留下的最大一段，不是对方的无限容量。」
- 授权复选框：「停止录音后，这段聊天音频会发到你填写的转写地址。cmspark 不保留音频。密钥只保存在这台电脑的 Companion 配置文件里，权限与现有聊天密钥相同，不是系统钥匙串。」
- 密钥下：「保存不会连接服务器，也不能证明该地址支持转写。」
- 纠错旁：「打开后，转写文字还会发给聊天模型。音频不会因此再发一次。」
- 到点：「已到录音时长上限。正在转写已录的这一段。」或「已到文件大小上限。正在转写已录的这一段。」
- 未发送取消：「已取消，没有发送音频。」
- 已发送取消：「已停止等待。音频可能已经到达你填写的服务器。」

- [ ] **Step 1: Write the failing test**

`chrome-extension/tests/voice-external-asr-ui.test.ts`

```ts
import assert from "node:assert/strict"
import test from "node:test"
import { resolveLocalFallbackActive } from "../src/sidepanel/hooks/useVoiceInput"
import {
  externalCancelCopy,
  externalLanguageTag,
  externalLimitCopy,
  externalShouldRefine,
} from "../src/sidepanel/voice/external-asr-ui"

test("language tag and refine gate", () => {
  assert.equal(externalLanguageTag("zh-CN"), "zh")
  assert.equal(externalShouldRefine(false, "你好"), false)
  assert.equal(externalShouldRefine(true, ""), false)
  assert.equal(externalShouldRefine(true, "你好"), true)
})

test("external does not use resolveLocalFallbackActive", () => {
  assert.equal(resolveLocalFallbackActive({
    configuredEngine: "external",
    autoFallbackToBrowser: true,
    companionConnected: true,
    localStateHydrated: true,
    localModelReady: false,
  }), false)
})

test("copy does not claim a probed connection or a keychain", () => {
  assert.match(externalLimitCopy("unprobed-local-default"), /不是探测/)
  assert.match(externalLimitCopy("deepseek-docs"), /8 MiB/)
  assert.match(externalCancelCopy(false), /没有发送音频/)
  assert.match(externalCancelCopy(true), /可能已经到达/)
})
```

同一文件再导出 `externalPrivacyCopy()`，测试断言它包含「不是系统钥匙串」。`configuredEngine: "external"` 在 `SttEngineKind` 加上 `"external"` 之前不能通过 `tsc`。这就是红。`resolveLocalFallbackActive` 的条件继续只认 `"local"`，不要为了编译而让 external 返回 true。

```ts
test("privacy copy names the file permission and not a keychain", () => {
  assert.match(externalPrivacyCopy(), /不是系统钥匙串/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix chrome-extension exec -- tsc -p tsconfig.test.json && node --test .test-dist/tests/voice-external-asr-ui.test.js .test-dist/tests/voice-fallback.test.js`

Expected: FAIL，新函数不存在或 external 被当成可回退。

- [ ] **Step 3: Write minimal implementation**

`resolveLocalFallbackActive` 的条件保持 `configuredEngine === "local"`。external 录音上限来自状态，不把 `LOCAL_STT_MAX_RECORD_MS` 传给 external start。`maxMs` 对 external start 省略。纠错请求只在 `externalShouldRefine` 为 true 时发送，字段仍是现有文字字段。

- [ ] **Step 4: Run test to verify it passes**

同一命令。Expected: PASS。再跑 `npm --prefix chrome-extension test` 中与 voice 相关的既有文件若被这条命令的全量所覆盖，留到 Task 7；本步至少上述两个文件 PASS。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/voice/external-asr-ui.ts chrome-extension/src/sidepanel/components/SettingsSlideout.tsx chrome-extension/src/sidepanel/hooks/useVoiceInput.ts chrome-extension/src/sidepanel/types.ts chrome-extension/src/sidepanel/store/agentStore.tsx chrome-extension/tests/voice-external-asr-ui.test.ts chrome-extension/tests/voice-fallback.test.ts
git commit -m "feat: show external ASR limits without a fake connection test"
```

**节点 2 门禁：** 独立评审 Task 4–6 的取消、脱敏、会议拒绝和预算隔离。FAIL 则停。PASS 之前不做 Task 7 的全量宣称。

---

### Task 7: 用户指南与全量回归

**Files:**

- Modify: `docs/meeting-and-dictation-user-guide.md`，加一节「外部转写」，写明只用于聊天、会议不变、保存不代表连通、32 MiB 是程序边界。
- 不改 README 的版本矩阵，除非该指南的导航已经链到 README；若链了，只加一句指针，不改版本号。

- [ ] **Step 1: Write the failing test**

不新增会打到网络的测试。指南改动没有红灯测试。安全矩阵以 Task 1–6 的测试名为准，本步只确认它们仍在。

- [ ] **Step 2: Run the existing suites**

Run:

```bash
npm --prefix companion test
npm --prefix chrome-extension test
```

Expected: 两边都是 0 fail。若失败，先看是不是本改动；不得删除或放宽原断言，不得把 45 秒、90 秒或 95 秒改大。

- [ ] **Step 3: Commit docs**

```bash
git add docs/meeting-and-dictation-user-guide.md
git commit -m "docs: describe external chat transcription limits"
```

- [ ] **Step 4: 节点 3 门禁**

推送后看该 SHA 的四条 workflow、十项检查。未全绿不请求合并。不因为无关失败重跑。不打 tag，不发 Release。合并由主对话执行。

## 安全与取消矩阵

| 测试名所属任务 | 必须失败的错误实现 |
|---|---|
| Task 1 公网 http / 链路本地 | 把地址写入配置 |
| Task 1 本机 http | 拒绝 `127.0.0.1` |
| Task 3 `"***"` 与空字符串 | 用掩码覆盖密钥，或把密钥放进 `voice.model.state` |
| Task 3 空密钥 `set_engine` | 写成 external |
| Task 4 abort 后再到的 text | 插入迟到文字 |
| Task 4 3xx | 第二次带 Bearer 的请求 |
| Task 5 `end` 前 abort | `fetch` 次数不为 0 |
| Task 5 15 秒无块 | 把残段发出去 |
| Task 5 3840044 字节 | 被 2500000 或 45 秒拒绝 |
| Task 5 会议 | 出现转写 HTTP |
| Task 6 纠错关闭 | 发出 `voice.refine.request` |
| Task 6 external 回退 | 启动浏览器识别 |

## 后续本地识别优化（非本计划任务）

Task 1–7 不实施这一节，也不在用户机器上测量。它与 spec 第 12 节是同一条记录。

已知代码事实：`buildWhisperArgs` 带 `-ng`，线程上限 6（`whisper-runner.ts` 54–86 行）；`modelPrewarm` 默认关。这不能写成用户机器慢的原因。

以后单独开计划时的顺序：同批真实中文录音的准确率与模型加载、推理、端到端分段耗时基线；然后才是 Mac 硬件加速可行性；然后是模型与语言参数；然后是冷启动、暖启动和预热；最后是周期性整段重解。只变快而准确率变差不算通过。没有这批测量，不得断言根因。

## 自审

- spec 第 5–9 节的地址、预算、取消、纠错、会议和密钥都有任务。
- 计划中的类型名在各任务间一致：`canonicalExternalUrl`、`validateExternalBudget`、`externalStopDecision({ committedWavBytes, candidatePcmBytes, maxDurationMs, maxBytes })`、`reduceExternalConfig`、`externalStateView`、`transcribeExternal`、`createExternalAsrSession`、`meetingExternalRefusal`、`ExternalLimitNote`。
- 会议测试文件固定为 `companion/tests/voice-external-asr-meeting.test.ts`，与 Task 5 的命令一致。
- 第 12 节与本计划文末的本地优化都不在 Task 1–7。
- 没有待定步骤。节点 0 不实现上表。
- 32 MiB 只出现为可见的保存上限，不出现为静默截断或服务商能力。
