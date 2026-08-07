# 听写+ D1 实现计划（D1a → D1b → D1c）

> **日期**: 2026-08-07  
> **SoT**: [dictation-plus-design.md](../specs/2026-08-07-dictation-plus-design.md)  
> **ADR**: [024](../../adr/024-dictation-plus-asr-refiner-meeting.md)  
> **状态**: 可执行计划 — **先 D1a**；D2/Mtg 另计划  

---

## 0. 原则

1. classic 零回归门禁：每个 PR 跑现有 voice 相关测 + 手动 45s 路径  
2. 小 PR：D1a / D1b / D1c **禁止**打成一个 merge  
3. 无 UI 承诺未 spike 的能力（≥3 min browser 须 S-WS1）  

---

## 1. D1a — continuous Mode A（browser 优先）

### 1.1 范围

| In | Out |
|----|-----|
| `voiceDictationMode` classic\|continuous 设置 | 热键 Mode B |
| continuous：adapter 内 onend restart + listenGen | ASR Refiner |
| 软 5 min / 硬默认 15 min（上限 30） | local 分段 |
| Panel 时长 + REC 态；可选真波形（有 stream 时） | 全局 HUD 胶囊 |
| classic 保持 45s + 无 restart | 会议 |

### 1.2 任务拆分

| # | 任务 | 主要文件（预期） | 验收 |
|---|------|------------------|------|
| A1 | prefs：`voiceDictationMode` 存 chrome.storage + 设置 UI 第一层开关 | SettingsSlideout, agentStore prefs, detect/constants | 默认 classic |
| A2 | `session-reducer`：mode 判别；continuous 不把「引擎暂停」当 ENGINE_END 提交 | session-reducer.ts, types.ts | 单测：continuous mid-end 不 commit |
| A3 | `web-speech-adapter`：classic 零 restart；continuous restart 循环 + gen | web-speech-adapter.ts | 单测 mock onend×N |
| A4 | `useVoiceInput`：timer 按 mode（45s vs soft/hard cap） | useVoiceInput.ts, detect.ts | continuous 不被 45s 杀掉 |
| A5 | UI：时长角标 + 软 cap chip + 硬停 banner 文案 | InputArea / error-map | 文案符合 SoT |
| A6 | 回归：local classic 仍 45s（若 engine=local） | local-stt-adapter | 不误开 continuous local |

### 1.3 Spike

- **S-WS1**：Chrome mac+Win zh-CN continuous ≥3 min + silence gaps，记录 restart 次数与掉字（可手工报告进 `docs/superpowers/specs/`）  

### 1.4 测试

- 扩展 unit：reducer + adapter restart  
- 手工：classic 45s banner；continuous 说 2–3 min 有字  

---

## 2. D1b — ASR Refiner

### 2.1 范围

| In | Out |
|----|-----|
| `asrRefinerEnabled` 默认 false | 书面化模式 |
| `voice.refine.*` + `asr-refiner.ts` 常量 prompt | incremental |
| phase `refining`；raw-first；dirty 不覆盖；还原原文 | 独立 API Key UI |
| `voice_privacy_ack_v3` 正文 + 门 | 会议串联 |

### 2.2 任务拆分

| # | 任务 | 验收 |
|---|------|------|
| B1 | Companion `ASR_REFINER_SYSTEM_PROMPT` + `runAsrRefine` + 长度/URL 守卫 | 单测 mock 同字 + 扩写拒 |
| B2 | WS handlers origin fence + abort | 非法 origin 拒 |
| B3 | Extension：stop → raw merge → optional refineGen request | stale gen ignore |
| B4 | UI：纠错中 chip；失败文案；还原按钮；开关旁模型名+披露 | SoT §7 |
| B5 | ack v3 sheet 正文（四通道相关条款） | 无 ack 无法开 refine |
| B6 | Pack strip 新键（若有 apply 管道） | 测 strip |

### 2.3 测试

- companion：`asr-refiner` character-identical 套件（SoT / R2 骨架）  
- extension：refining + dirty + abort  

---

## 3. D1c — local 串行分段 continuous

### 3.1 范围

| In | Out |
|----|-----|
| continuous + local：30–45s 窗口串行 `voice.stt` | 并发双 slot STT |
| TranscriptBuffer 追加 segment finals | 假 interim 字 |
| 间隙「转写中…」诚实 UI | 抬 STT_MAX_RECORD_MS 到 15min |

### 3.2 依赖

- D1a controller/mode 稳定  
- Path B 现有 max-1 / 45s 校验保持  

### 3.3 Spike

- **S-LOC1**：5×45s 合并 + 中途 abort  

---

## 4. 建议 PR 顺序

```text
PR1  D1a prefs + SM + browser restart + caps + tests
PR2  D1b refiner companion + extension + ack v3
PR3  D1c segmented local continuous
```

每 PR：companion + extension 相关测绿；不改会议代码。

---

## 5. 非目标（本计划）

- D2 热键 / HUD  
- Mtg0/Mtg1  
- auto-send、书面化、系统注入、Fn 默认  

---

## 6. 开工命令（实现时）

```bash
# companion
npm --prefix companion test -- --testPathPattern=voice
# extension
npm --prefix chrome-extension test -- --testPathPattern=voice
```

---

## 7. 变更记录

| 日期 | 变更 |
|------|------|
| 2026-08-07 | 初版：对齐 Dictation+ SoT D1a/b/c |
