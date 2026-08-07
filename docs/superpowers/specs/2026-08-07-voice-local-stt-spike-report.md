# Path B Local STT — Spike S0–S5 Report

> **日期**: 2026-08-07  
> **主机**: macOS 26.5.2 · **arm64** (Apple M5 Max) · Node v24 · Google Chrome (人工门禁待勾)  
> **SoT**: [2026-08-07-voice-local-stt-design.md](2026-08-07-voice-local-stt-design.md)  
> **ADR**: [ADR-023](../../adr/023-voice-local-stt-path-b.md)  
> **状态**: **CONDITIONAL PASS** — 机器门禁绿；**真人 gUM / MediaRecorder 扩展 tab / Windows** 待操作者勾选后进 M0

---

## 1. Spike 交付物

| 路径 | 作用 |
|------|------|
| `chrome-extension/src/sidepanel/voice/local-stt-detect.ts` | S0/S1 纯 detect + 45s PCM 预算常量 |
| `chrome-extension/src/sidepanel/voice/pcm-encode.ts` | S2：resample → s16le → WAV · chunk split（无 Buffer/ffmpeg） |
| `chrome-extension/tests/voice-local-stt-spike.test.ts` | 9 单测（S0–S2 机器） |
| `chrome-extension/src/tabs/voice-permission.tsx` | **S0**：优先 `getUserMedia` grant，再 best-effort SpeechRecognition |
| `chrome-extension/src/tabs/voice-pathb-spike.tsx` | **人工** S0–S2：录 5s/45s → 解码 → WAV16k 报告 |
| `companion/src/voice/session-caps.ts` | 超时/字节/模型 allowlist 常量 |
| `companion/src/voice/stt-session-core.ts` | S5 纯会话：max-1、seq、预算、abort epoch |
| `companion/src/voice/binary-resolve.ts` | S4 resolve + SHA256 pin 模式 |
| `companion/tests/voice-stt-session-core.test.ts` | 8 单测 |
| `companion/tests/voice-binary-resolve.test.ts` | 6 单测 |
| `scripts/voice-pathb-s3-whisper-probe.sh` | S3：brew whisper-cli + tiny ggml + 1s WAV |
| `scripts/voice-pathb-s5-session-probe.mjs` | S5 进程内 reassembly 探针 |
| 探针 JSON | `docs/audit/reviews/voice-pathb-s3-*.json` · `s4-*.json` · `s5-*.json` |

**未做（诚实）**：生产 `cmspark-whisper` 随包二进制（M1）；真实 WS 分片上 Companion（M1）；prod Plasmo build 未在本轮跑（无 `audioCapture` 源码引用）。

---

## 2. 门禁记分板

| ID | 门禁 | 结果 | 证据 |
|----|------|------|------|
| **S0-M** | `detectLocalMediaCapture` 纯逻辑 | **PASS** `[executed]` | extension 9 tests 中 2 条 |
| **S0-H** | 扩展 tab `getUserMedia` grant 真麦 | **PENDING human** | `voice-permission` + `voice-pathb-spike` |
| **S1-M** | 45s PCM 估算 ≤ 2.5MB 预算 | **PASS** `[executed]` | `1_440_000` B @ 16k s16le mono |
| **S1-H** | Side Panel / 扩展页 MediaRecorder 5s+45s 实测 blob | **PENDING human** | spike 页 Record 按钮 |
| **S2-M** | 无 ffmpeg：float→16k WAV 纯函数 | **PASS** `[executed]` | RIFF/WAVE header + 48k→16k 长度 |
| **S2-H** | 浏览器 decodeAudioData → encodeMonoFloatToWav16k | **PENDING human** | pathb spike onstop 路径 |
| **S3** | whisper.cpp CPU/Metal 跑通 1s WAV | **PASS** `[executed]` | `whisper-cli` exit 0 · wall ~6s 冷启动 · encode ~78ms · Metal M5 Max |
| **S4** | resolve + pin match / mismatch | **PASS** `[executed]` | 14 companion tests 中 6 + s4 JSON |
| **S5** | chunk reassembly / abort / busy / budget | **PASS** `[executed]` | 8 session tests + s5 probe |
| **F-S-B13** | 无 `audioCapture` 源码依赖 | **PASS** `[inspected]` | repo 无 audioCapture 引用；prod build 本轮 skip |
| **Win** | Windows Chrome + whisper | **NOT RUN** | 仅 macOS arm64 |

**机器门禁 (S0-M, S1-M, S2-M, S3, S4, S5): PASS**  
**进 M0 代码**: 允许（下载管线不依赖真人麦）  
**进 M1 听写闭环**: 须 **S0-H / S1-H / S2-H** 至少在 Tier-1 Chrome macOS 勾选一次

---

## 3. 机器探针摘录

### S3 whisper-cli (darwin-arm64)

```json
{
  "status": "pass",
  "whisperBin": "/opt/homebrew/bin/whisper-cli",
  "wallMs": 6168,
  "note": "tiny model for machine gate only; production catalog is small|medium|large-v3-turbo"
}
```

日志显示 **MTL / Apple M5 Max** 后端；1s 合成正弦 → 文本噪声 `[Bell]`（预期；机器门只要求进程成功）。

### S4 pin

```text
pin match → ok:true pinned:true
pin mismatch → reason:hash_mismatch
```

### S5

```text
start + 3 chunks + end reassembly OK
abort → late chunk session_unknown OK
```

### 测试命令（复现）

```bash
# Extension S0–S2
cd chrome-extension && npx tsx --test tests/voice-local-stt-spike.test.ts

# Companion S4–S5
cd companion && npx tsc -p tsconfig.test.json \
  && node --test .test-dist/tests/voice-stt-session-core.test.js \
             .test-dist/tests/voice-binary-resolve.test.js

# S3
bash scripts/voice-pathb-s3-whisper-probe.sh

# S5 probe JSON
node scripts/voice-pathb-s5-session-probe.mjs
```

---

## 4. 架构结论（锁定进 M0/M1）

| 问题 | Spike 结论 |
|------|------------|
| ffmpeg？ | **不需要** v1：Ext 侧 float→WAV16k 纯函数足够 |
| MediaRecorder 输出 | 可先 WebM/Opus，再 **AudioContext.decode → PCM 路径**（S2-H 验证） |
| whisper 可行性 | **PASS** on arm64；生产仍应随包 `cmspark-whisper` + pin（勿依赖 brew） |
| 会话协议 | 纯 core 可测；全局 max-1 / seq / abort 已实现 |
| 权限 bootstrap | **必须** gUM（本轮 permission 页已改）；仅 SpeechRecognition 不够 Path B |

### S3 对推荐档的暗示（非锁死）

本机 Metal 上 tiny 推理极快；**medium vs turbo** 仍须 S3 级用 **中文短指令真实录音** 对比后再改 UI 推荐（SoT 允许一行改）。本 spike **未**下载 medium/turbo 生产权重。

---

## 5. 人工验收（操作者 10 分钟）

### 5.1 构建并加载扩展

```bash
cd chrome-extension && npm run build
# Chrome → 加载已解压 → chrome-extension/build/chrome-mv3-prod/
```

### 5.2 S0 — permission tab

```text
chrome-extension://<ID>/tabs/voice-permission.html
```

期望：`getUserMedia: granted` 或明确拒权文案。勾 **S0-H**。

### 5.3 S1–S2 — pathb spike

```text
chrome-extension://<ID>/tabs/voice-pathb-spike.html
```

1. **Record 5s** → 看 log：blob 大小、wav16k 大小、chunks  
2. **Record 45s**（可提前 Stop）→ blob 合理、PCM 估算在预算内  
3. **Export report JSON** 存档  

勾 **S1-H / S2-H**。

### 5.4 Windows（可选）

同 spike 页 + 若有 `whisper-cli` 或未来 `cmspark-whisper-win-x64` 再跑 S3 脚本。

---

## 6. 相对 M0 / M1 的建议

| 波次 | 本 spike 后 |
|------|-------------|
| **M0** | **可开**：whisper manifest + download UI + `voice.model.*`（settings-only）；**无需**真人麦 |
| **M1** | 打包 `cmspark-whisper` + pin；接 `SttSessionCore` + runner；Ext `local-stt-adapter`；**先完成 S0–S2 人工** |
| 勿做 | 在 M0 合生产 `voice.stt.*` 上传路径却无 gUM 人工证据 |

---

## 7. 修订

| 日期 | 事件 |
|------|------|
| 2026-08-07 | S0–S5 交付：纯模块 + 测试 + brew whisper-cli 探针 + 人工清单 |

---

*End spike report — machine PASS; human S0–S2 PENDING.*
