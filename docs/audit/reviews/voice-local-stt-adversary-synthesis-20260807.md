# Adversary Synthesis — 本机语音识别（Path B Local STT）

**Date**: 2026-08-07  
**Strawman**: `docs/superpowers/specs/2026-08-07-voice-local-stt-design-strawman.md`  
**SoT (post-adversary)**: `docs/superpowers/specs/2026-08-07-voice-local-stt-design.md`  
**Agents**: Product/UX · Security/Privacy/Trust · Platform/Compat/Packaging · Impl architect  
**Score**: **MAJOR_REVISE × 4** — 产品目标均未 `REJECT_PRODUCT_GOAL`；strawman **不可直接实现**

---

## 1. Scoreboard

| Agent | Verdict | Core stance |
|-------|---------|-------------|
| Product/UX | **MAJOR_REVISE** | 核心用户是隐私/内网，不是「更好听写大众」；双引擎对等 UI 是税；主推单推荐档；listening 无 interim 必须补计时反馈；显式失败脱困 |
| Security/Trust | **MAJOR_REVISE** | 音频进 Companion 须重写 Trust；禁静默回落；禁错误 toast 一键切云；session 绑定/字节 cap/tmp/Pack 禁写/日志脱敏/ack v2 须成 floors |
| Platform | **MAJOR_REVISE** | 禁 ffmpeg；Ext→PCM；MediaRecorder 未 spike；二进制 SHA256；磁盘预算与 Qwen 诚实分账；RAM 共存硬门 |
| Impl | **MAJOR_REVISE** | Companion SoT for engine+model；禁双写；独立 voice/ 模块；processing 态；max-1 session+epoch；fork whisper manifest |

**产品目标**（opt-in 本机 Whisper → 草稿 only）四路均接受。  
**Strawman 预决策**（whisper.cpp、Ext→WS→Companion、随包 binary、用户下权重）**可保留**，包装与安全密度必须重写。

---

## 2. Conflict resolution（写入 SoT）

| 冲突 | 决议 |
|------|------|
| Product 一键改 browser vs Security「仅打开设置」 | **允许错误 banner 上显式 CTA「改用浏览器听写」**：一次点击切换 `sttEngine=browser`（settings-gated 同源写）+ 同行披露「可能经浏览器厂商云端」；**禁止静默**；**禁止**无披露一键 |
| Product 主推 1 档 vs 用户/strawman 三档 | **三档均可下载**，UI **主推 1 个推荐档 = medium**；small / large-v3-turbo 折叠「其他型号」 |
| Qwen 共存：软文案 vs 硬拦截 | **磁盘：预算 fail-closed**；**运行：若 Qwen-VL 会话已 loaded 且用户启动 local STT → 确认对话框**（数字/风险一句）；无可靠 free-RAM 探针时不静默 OOM |
| prefs：chrome vs Companion | **Companion SoT：`sttEngine` + `localModelId`**；**chrome.storage：`voiceInputEnabled` + `voice_privacy_ack_v2`**；扩展只镜像引擎/模型状态 |
| decode：WebM/ffmpeg vs PCM | **Extension 产出 16 kHz mono PCM/WAV**；Companion **不绑 ffmpeg** |
| 失败推荐本机 | **v1 无 modal upsell**；仅设置/错误文案一行链 |
| 下载入口 | **mutate 仅设置页 `source:"settings"`**；进度可全局广播；composer 仅 deep-link |
| 质量承诺 | **删除「比系统听写更稳」SLA**；诚实为隐私路径 + 可选质量因模型/环境而异 |

---

## 3. Mandatory floors（进入 SoT）

### Product/UX — F-UX-B*

| ID | Floor |
|----|--------|
| F-UX-B1 | 默认 `sttEngine=browser`；禁止自动下载权重 |
| F-UX-B2 | 文案框架「听写方式」；禁「语音 Agent / 升级引擎」 |
| F-UX-B3 | UI 主推 **medium**；其他档折叠 |
| F-UX-B4 | 下载仅设置发起；🎤 从不触发下载 |
| F-UX-B5 | 下载可取消；进度可离开设置仍可见；失败可重试/删残片 |
| F-UX-B6 | local 未就绪 → Disable + **banner 级**文案（不止 tooltip） |
| F-UX-B7 | browser 引擎门控与 M1 一致（含断连仍可 browser 听写） |
| F-UX-B8 | 同一 🎤：点按、≤45s 收听、无 auto-send、主线程 only |
| F-UX-B9 | local listening：**已听秒数/剩余 cap** +「结束后本机识别」 |
| F-UX-B10 | **processing** 显式态；可 abort；禁双会话；取消不合并半截 |
| F-UX-B11 | 禁静默回落 browser；允许 **显式+披露** CTA 切 browser |
| F-UX-B12 | CTA 切 browser = 写 prefs（非幽灵单次）+ toast |
| F-UX-B13 | local 首次：**ack v2**；不声称全产品离线 |
| F-UX-B14 | 空结果/超时/OOM/缺二进制/校验失败均有中文路径 |
| F-UX-B15 | 切线程/Stop/abort/卸载：abort 录音+STT session |
| F-UX-B16 | Qwen：下载文案；运行冲突 confirm |
| F-UX-B17 | 成功：≥15 字中文可编辑发送 + local 路径无浏览器云 STT |
| F-UX-B18 | 320px：不新增长驻第三状态行；用 mic 视觉 + 既有 banner |

### Security — F-S-B*

| ID | Floor |
|----|--------|
| F-S-B1 | 双引擎 residual 矩阵 + 禁「完全本地/零风险」 |
| F-S-B2 | `voice_privacy_ack_v2` 强制条款（见 SoT） |
| F-S-B3 | 无 auto-send UI/config |
| F-S-B4 | voice 永不授工具/L2/auto_approve |
| F-S-B5 | Pack 不得写 voice* / engine / ack / auto-send |
| F-S-B6 | `voice.stt.*` 仅 auth + `chrome-extension://` origin |
| F-S-B7 | session 绑定 ws；max-1；seq；服务端 45s；聚合字节 cap |
| F-S-B8 | tmp sandbox + 0o600 + 全出口 unlink + boot GC |
| F-S-B9 | 下载：https/sha256/redirect 手控/超流截断/预算/`source:settings`/无自动更新 |
| F-S-B10 | 二进制固定路径 + SHA256 pin；execFile 无 shell；model allowlist |
| F-S-B11 | 禁静默回落；CTA 须披露云 residual（合成决议） |
| F-S-B12 | 日志禁音频/全文 transcript；仅 code/size/ms/modelId |
| F-S-B13 | 无 `audioCapture` manifest |
| F-S-B14 | 引擎真相：Companion SoT；徽章与路径一致 |
| F-S-B15 | 主线程 only（F-S9 延续） |
| F-S-B16 | 新 Path B ADR（WS family + Trust residual） |

### Platform — F-C-B*（摘要）

| ID | Floor |
|----|--------|
| F-C-B1 | Tier-1：Chrome · macOS arm64/x64 · Win x64 |
| F-C-B2–B3 | 无 audioCapture；permission tab 必须 gUM |
| F-C-B4 | MediaRecorder/gUM spike 过门再写 M1 生产协议 |
| F-C-B5 | 16 kHz mono PCM/WAV；禁 ffmpeg 依赖 |
| F-C-B6 | chunk 强制；单片/会话 cap |
| F-C-B7–B8 | abort 三体；record/upload_idle/infer 分超时 |
| F-C-B9–B10 | resolveWhisperBinary + SHA256/TOCTOU |
| F-C-B11–B12 | whisper 独立目录+预算（或联合预算诚实展示） |
| F-C-B13 | Qwen loaded 时运行 confirm |
| F-C-B14–B20 | 矩阵/离线/打包/签名/tmp/catalog 诚实 |

### Impl — F-I-B*

| ID | Floor |
|----|--------|
| F-I-B1 | Companion owns engine+modelId |
| F-I-B2 | process-global 单 STT session |
| F-I-B3 | sessionId+epoch；晚到消息 no-op |
| F-I-B4 | chunk seq/cap 严格 |
| F-I-B5 | voice.model.* `source:settings` 双栏 |
| F-I-B6 | 音频零持久（tmp only） |
| F-I-B7 | 无静默 browser fallback |
| F-I-B8 | abort 永不污染 baseText/draft |
| F-I-B9 | Ext PCM 解码所有权 |
| F-I-B10 | whisper 独立 manifest family |
| F-I-B11 | runner 隔离+超时 kill |
| F-I-B12 | CI 无真实大权重 |

---

## 4. Locked product narrative（一句）

> **可选：在本机 Companion 用已下载的 Whisper 转写语音（默认仍是浏览器听写）；始终只进草稿、不自动发送；音频临时进 Companion，用后删除。**

---

## 5. Ship order

```text
SoT lock (this synthesis → design.md)     ✅
  → Pi re-review of SoT + synthesis       ✅ APPROVE_WITH_NITS
  → Path B ADR (Trust + WS family)        ✅ ADR-023
  → Spike S0–S5 (gUM + PCM + whisper CPU + abort)  ✅ machine PASS
  → M0: manifest + download/delete/progress (no STT WS)
  → M1: binary + runner + WS + adapter + processing + ack v2
  → M2: hard RAM mutex、更多档叙事、GPU、流式 partial
```

---

## 6. Pi re-review

| | |
|--|--|
| Verdict | **APPROVE_WITH_NITS** |
| Artifact | `docs/audit/reviews/voice-local-stt-design-pi-20260807-154150.md` |
| JSON | `docs/audit/reviews/voice-local-stt-design-verdict-pi-20260807-154150.json` |

Nits absorbed into SoT（错误表、budget scope、UI draft、CTA source、lastKnown 镜像、banner、0o600、S3 复核推荐档）。  
**Gate: SoT ready for Path B ADR draft + spike S0–S5 + M0.**

---

*Internal adversary gate: MAJOR_REVISE **resolved by SoT patch**, not overridden. Pi external: APPROVE_WITH_NITS.*
