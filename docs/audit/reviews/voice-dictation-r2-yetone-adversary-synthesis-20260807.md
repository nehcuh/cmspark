# Adversary Synthesis R2 — yetone VoiceInput 对照后的听写形态

**Date**: 2026-08-07  
**Strawman**: `docs/superpowers/specs/2026-08-07-voice-dictation-r2-yetone-informed-strawman.md`  
**R1 合成（仍有效）**: `docs/audit/reviews/continuous-dictation-meeting-adversary-synthesis-20260807.md`  
**参考**: [yetone/voice-input-src](https://github.com/yetone/voice-input-src)（规格即 prompt；hold Fn · Apple Speech · 保守 LLM refine · 系统粘贴 · 胶囊 HUD）  
**Agents**: Product/UX · Security/Privacy/Trust · Platform/Compat · Impl architect  

---

## 1. Scoreboard

| Agent | Verdict | Core stance |
|-------|---------|-------------|
| Product/UX | **PASS_WITH_CHANGES** | 抄纠错哲学与可见录制；不抄系统听写人格；HUD 须品牌化「草稿」 |
| Security/Trust | **PASS_WITH_CHANGES** | Refiner 默认关 + 服务端固定 prompt + ack 写清「文本进 LLM」；禁系统注入 |
| Platform/Compat | **MAJOR_REVISE**（包装层） | 可做 L-B 应用内版；Mode B HUD **分档**（mac 胶囊 / Win tray）；禁 Apple Speech 第三引擎；Fn 仅 spike |
| Impl | **PASS_WITH_CHANGES** | final-only `llmExtract` + refineGen + raw-first；D3 incremental **取消**；prompt 编译期常量 |

**产品目标**：四路均 **不** `REJECT`。  
**R2 相对 R1**：净正收益——把「润色」升级为 **ASR Refiner**，对齐 yetone 保守哲学，并砍掉边听边 LLM。  
**yetone 宿主模型（系统注入 + 默认 Fn + Apple Speech）**：**不可**原样搬进 CMspark。

---

## 2. 一句话：CMspark 合适形态

> **CMspark 听写+** = Side Panel（及可选按住快捷键）把语音变成 **Agent 草稿**；可选 **极保守 ASR 纠错**（谐音/术语，正确则原样）；**不是**系统听写，**不是**语音 Agent，**不是**会议纪要。

yetone ≈ **OS 原生全局听写 + refine**。  
CMspark L-B ≈ **应用内 composer 听写 + 同哲学 refine**。  
会议 L-C **仍然独立**（R1 不推翻）。

---

## 3. yetone 可抄 / 不可抄（合成锁）

### 可抄

| ID | 点 | 落入 |
|----|----|------|
| Y-OK-1 | LLM = refine **非** rewrite；正确则原样 | ASR Refiner SoT + 回归测 |
| Y-OK-2 | **仅 stop 后** refine | D1b；取消 D3 incremental |
| Y-OK-3 | Hold 形态一等 | D2 Mode B |
| Y-OK-4 | 真电平 / 可见录制 | Panel 波形 + 全局 indicator |
| Y-OK-5 | 「纠错中…」再落稿 | phase `refining` |
| Y-OK-6 | 复用已配置 LLM | Companion 当前模型 |
| Y-OK-7 | 规格即 prompt 附件 | `ASR_REFINER_SYSTEM_PROMPT` 代码常量 + SoT 附录 |

### 不可抄

| ID | 点 | 原因 |
|----|----|------|
| Y-NO-1 | 注入任意 App 焦点框 | 身份与 Trust；MV3 做不到干净 |
| Y-NO-2 | 剪贴板 + Cmd+V 作主路径 | 竞态 / 密码框 |
| Y-NO-3 | 默认 hold Fn | R1 + Platform；仅 mac 高级 spike |
| Y-NO-4 | 无品牌「系统感」胶囊当默认人格 | 用户会以为系统听写 |
| Y-NO-5 | Apple Speech 作第三引擎 | mac-only + TCC + 双引擎矩阵爆炸 |
| Y-NO-6 | 用户/Pack 可改 refine system prompt | 变润色 Agent |
| Y-NO-7 | 边听边 LLM | 草稿竞态 + 预发送放大 |

---

## 4. 对 R1 的显式修订（仅这些）

| R1 项 | R2 修订 |
|-------|---------|
| 「Final polish / 润色」命名 | → **ASR Refiner（识别纠错）**；UI 禁「润色/书面化」作默认文案 |
| F-UX-CD9 书面化「优先于」纠错 | → v1 **不提供**书面化 UI；仅 `correct_only` |
| D3 Incremental「可选/可砍」 | → **取消（CANCELLED）**，不进 L-B 路线图 |
| R1 对外 one-liner「LLM 润色草稿」 | → 「可选 **ASR 纠错**」 |
| Mode B HUD 未分档 | → **分档**：mac 可 NSPanel 胶囊；Win **tray REC 即可合规** |
| ack v3 | → **正文必须含**「纠错会把**转写文本**发给已配置 LLM」；无则 v3 不能开 Refiner |

**不修订**：classic 默认 · 无 auto-send · 硬 cap 15/30 · 禁默认 fn/Win+V · 会议独立 · 系统注入 v1 否 · Pack strip · 主线程 composer。

---

## 5. 增量 floors（F-*-R2*，叠加 R1 F-*-CD*）

### Product

| ID | Floor |
|----|--------|
| F-UX-R2-1 | 叙事 = Agent **草稿**听写增强；禁「系统听写 / yetone 平替」 |
| F-UX-R2-2 | UI 名「ASR 纠错」；禁默认「润色/书面化」 |
| F-UX-R2-3 | 320px ≤ 一条 listening 反馈 + 至多一个瞬时 chip |
| F-UX-R2-4 | 反馈单源：Panel 前台用 Panel；失焦/Mode B 升级 tray/HUD **之一** |
| F-UX-R2-5 | 全局 HUD 须含 **CMspark · 草稿** 语义，禁纯系统胶囊 |
| F-UX-R2-6 | 停止 → 纠错中可取消 → 写草稿；永不 auto-send |
| F-UX-R2-7 | **正确短句 character-identical** 为验收门禁 |
| F-UX-R2-8 | 设置 ≤3 概念：连续听写 · 按住快捷键 · ASR 纠错 |
| F-UX-R2-9 | 不预告边说边纠错 |
| F-UX-R2-10 | Refiner 后 **还原识别原文** 一等 |
| F-UX-R2-11 | 开关旁：「发**文本**给当前模型纠错，不发音频」+ 模型名 |
| F-UX-R2-12 | Mode B 失败可听（Panel 关 / 断连） |
| F-UX-R2-13 | L-B 不偷 L-C 会议入口 |
| F-UX-R2-14 | Demo 成功 = 字在 composer，非任意 App |

### Security

| ID | Floor |
|----|--------|
| F-S-R2-1 | Refiner text-only；payload 仅 transcript buffer |
| F-S-R2-2 | **System prompt Companion 固定**；客户端/Pack 不可替换 |
| F-S-R2-3 | Pack strip 扩展 `asr_refiner*` / `refiner_prompt*` / rewrite 模式 |
| F-S-R2-4 | Refiner **默认 OFF** + ack v3 正文 |
| F-S-R2-5 | v1 仅 correct_only |
| F-S-R2-6 | 输出校验：长度界、新 URL/密钥启发式、拒 tool_call 形态 → raw |
| F-S-R2-7 | 无 incremental refine |
| F-S-R2-8 | 纠错中 draft 所有权 |
| F-S-R2-9 | 失败 merge raw |
| F-S-R2-10 | job 家族硬拆：`asr_refiner` ≠ `meeting_minutes` |
| F-S-R2-11 | 会议串联须双披露；默认 off |
| F-S-R2-12 | 系统注入 v1 **禁止** |
| F-S-R2-13 | Fn tap 非默认；Accessibility 预提示；失败隐藏 |
| F-S-R2-14–18 | stuck-key · 日志无正文 · ack 条款 · 放大有害口令 residual 文档化 · 模型残差展示 |

### Platform

| ID | Floor |
|----|--------|
| F-C-R2-1 | 注入面 = Side Panel composer only |
| F-C-R2-2 | Mode B 控制面 Companion；音频/STT 仍 Extension |
| F-C-R2-3 | 全局 indicator **分档**：mac 胶囊可选；Win tray 合规 |
| F-C-R2-4 | 原生 HUD **nonactivating**；不抢 Chrome 焦点 |
| F-C-R2-5 | Dictation HUD ≠ L2 Confirm 视觉 |
| F-C-R2-6 | 裸 Fn 永不默认 |
| F-C-R2-7 | **无** Apple Speech 第三引擎 v1 |
| F-C-R2-8 | 真 RMS 来自 Extension stream；可 `voice.level` 镜像；禁 tray 第二麦 |
| F-C-R2-9 | 胶囊 interim 仅真实 partial 或 segment final；禁伪造字 |
| F-C-R2-10–15 | Win tray · Panel 关闭 fail-closed · 单 Swift 二进制 hash · 系统听写停车场 · ADR 非目标 |

### Impl

| ID | Floor |
|----|--------|
| F-I-R2-1 | Prompt = **编译期常量** `companion/src/voice/asr-refiner.ts` |
| F-I-R2-2 | `llmExtract` 无工具 · AbortSignal |
| F-I-R2-3 | **一听一 refine**；D3 永久取消 |
| F-I-R2-4 | `refineGen` 世代 |
| F-I-R2-5 | dirty 不覆盖 |
| F-I-R2-6 | **raw-first** 再可选替换 voice-span |
| F-I-R2-7 | fail-open raw |
| F-I-R2-8 | 服务端输出后置校验 |
| F-I-R2-9 | phase `refining`；无 mid-listen LLM 相 |
| F-I-R2-10–18 | 模块落点 · HUD 隔离 · RMS 控制面 · Pack strip · temp≤0.2 · 同字回归 · 日志 · 矩阵减负 |

---

## 6. Locked defaults（R2 Q-*）

| Q | 锁定 |
|---|------|
| **Q-REF1** | Refiner **默认 OFF** |
| **Q-REF2** | 失败 **保留 raw** |
| **Q-REF3** | v1 **无书面化 UI** |
| **Q-HUD1** | Panel 前台可仅 Panel；失焦 **3–5s** 升级 tray/HUD；Mode B 始终全局 indicator |
| **Q-HUD2** | Win = tray 强 REC；不阻塞无 Swift 胶囊 |
| **Q-INJ1** | **v1 不做**系统级注入 |
| **Q-FN1** | 仅 mac 高级 spike；失败隐藏；非默认 |
| **Q-LLM-CFG** | Companion **当前模型** |
| **Q-MEET-X** | 串联可选、默认 off、两 job 明示；不挡 L-B |

---

## 7. ASR Refiner system prompt（锁定草案 → 代码常量）

沿用 strawman §3.2；实现时 **一字不差进** `ASR_REFINER_SYSTEM_PROMPT`，并加：

- `temperatureCap ≤ 0.2`  
- 输出长度界 ~1.3–1.5×  
- 无 URL/tool 形态新内容则拒 → raw  
- CI：正确短句 **character-identical** mock 套件  

---

## 8. Ship order（R1 + R2 合并）

```text
D0   两份 SoT（Dictation+ 吸收 R1+R2 floors；Meeting 仍独立）
     + ADR 修订/新稿（Refiner、HUD 分档、非目标系统注入）

D1a  continuous 点按 + cap + 吵 REC + Panel 真波形（有 stream 时）
D1b  ASR Refiner opt-in + ack v3 正文 + 同字回归测
D1c  local 串行分段

D2   Hold 快捷键 + 全局 indicator（mac 胶囊渐进；Win tray 必达）

D3   — CANCELLED —

Mtg0 Pack 纪要（可并行）
Mtg1 会议工作台（依赖 D1c）

停车场: 系统级注入 / 默认 Fn / Apple Speech / 书面化 UI / 自动 diarize
```

**Spikes（R2 增补）**

| Spike | 门禁 |
|-------|------|
| S-REF1 | mock 保守套件 + 手工「配森→Python」 |
| S-HUD-MAC-VOICE | nonactivating 底部胶囊；不抢焦 |
| S-HUD-WIN-TRAY | tray ●REC + 时长 |
| S-LEVEL-WS | Extension RMS → HUD（可选） |
| S-FN-MAC | 仅当要做高级 Fn |
| S-WS1 / S-LOC1 / S-HK-* | R1 仍有效 |

---

## 9. Residual risks（R2 后仍在）

| ID | Risk | Level |
|----|------|-------|
| R2-R1 | 模型不遵守「原样返回」 | High → 守卫 + 测 + 不承诺 online 100% |
| R2-R2 | HUD 太像 yetone → 期待任意 App | High → 品牌文案 + 禁 demo 系统粘贴 |
| R2-R3 | 预发送文本→LLM（Refiner on） | Medium |
| R2-R4 | correct_only 让危险口令更清晰 | Low–Med（无 auto-send 兜底） |
| R2-R5 | Win tray vs mac 胶囊体感差 | Medium |
| R2-R6 | Fn spike 伤 emoji / estop | Medium if shipped |
| R2-R7 | classic/continuous 双模式回归 | High if 缺测 |

---

## 10. Pi / SoT readiness

| Gate | Status |
|------|--------|
| R1 floors | Still binding |
| R2 floors | This file |
| yetone 映射 | §3 locked |
| Strawman as SoT | **No** — absorb into Dictation+ SoT |
| Implementation | **After** SoT (+ optional Pi) |

---

## 11. Artifacts

| 文件 | 角色 |
|------|------|
| R2 strawman | `docs/superpowers/specs/2026-08-07-voice-dictation-r2-yetone-informed-strawman.md` |
| R2 合成 | **本文件** |
| R1 合成 | `continuous-dictation-meeting-adversary-synthesis-20260807.md` |
| yetone | https://github.com/yetone/voice-input-src |

---

## 12. 对外叙事（可用）

**ZH**  
> 参考开源 VoiceInput 的「停后保守纠错 + 可见录音」体验，CMspark 把能力做在 **Agent 草稿**里：可选连续/按住听写，可选 ASR 纠错（不润色、不自动发送）。会议纪要仍是独立场景。

**EN**  
> Inspired by yetone VoiceInput’s hold-to-talk and conservative ASR refine, CMspark ships the same *philosophy* inside the agent composer—never system-wide paste, never rewrite-as-polish by default.
