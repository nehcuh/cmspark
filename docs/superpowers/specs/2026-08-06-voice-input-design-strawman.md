# 语音输入（Voice Input）— 产品设计 Strawman（待对抗）

> **日期**: 2026-08-06  
> **状态**: STRAWMAN — 供四路对抗攻击，**非**锁定 SoT  
> **触发**: 用户问「是否可加语音输入」→ 可；本文件进入对抗验证再锁  
> **ADR**: 020 Surface L0 输入形态；不抬升 L1/L2 / Trust

---

## 0. 一句话（草案）

**Side Panel 输入区增加可选麦克风：按住/点按说完 → 浏览器侧转写为文字 → 填入 composer 或直接发送；默认不上传音频到 Companion，不改变任何 L2 门禁。**

---

## 1. 问题 / JTBD

| | |
|--|--|
| **谁** | 边看网页边指挥 Agent 的用户（中文为主） |
| **场景** | 双手占着、长指令懒打、边读边说 |
| **失败态今天** | 只能键入；系统听写可绕开但无产品内状态/取消/隐私说明 |
| **成功** | ≤2 次点击开始说；转写可编辑；可发；拒权/失败可理解 |

---

## 2. 目标 / 非目标（草案）

### 2.1 目标 v1

1. L0 composer 麦克风入口（全 capability 档可见，不抬 Surface）  
2. Web Speech API 转写 → textarea  
3. 模式：**说完进草稿**（默认）+ 可选 **说完直接发送**（设置）  
4. 首次麦克风明确权限 + 隐私一句（音频不经 Companion）  
5. 可随时停止；忙态/RunBusy 下规则与键盘发送一致  

### 2.2 非目标 v1

- TTS 读回复  
- Companion 上传音频 / Whisper 云 STT  
- 持续「始终听」唤醒词  
- 多语言自动检测引擎  
- Cockpit / tray 独立语音入口  
- 用语音绕过 L2 / 确认台  

---

## 3. 方案选型（草案锁 A）

| 方案 | 说明 | 草案 |
|------|------|------|
| **A Web Speech** | Extension Side Panel `SpeechRecognition` | **v1 唯一** |
| B Companion STT | MediaRecorder → Companion | P2+ 企业 opt-in |
| C 仅文档推荐系统听写 | 零代码 | 不满足产品差异 |

---

## 4. UX 草图

- 发送按钮左侧：🎤  
- 状态：idle / listening（脉动） / processing / error  
- Interim 字显示在 composer 或一行 live caption  
- Final 合并进 textarea；用户可改再发  
- 设置 → 输入：`voice_input_enabled` · `voice_auto_send` · `voice_lang`（默认 `zh-CN`）  

### Composer 交互锁（草案）

| 态 | 行为 |
|----|------|
| ThreadBusy / l2_task hard-gate | 可听写填草稿；**发送**仍走现有 gate |
| 正在 listening 时点停止对话 | 停听写 + 现有 abort |
| 空转写结束 | toast「未识别到内容」不发 |

---

## 5. 信任 / 隐私（草案）

```text
Surface:      L0 输入 only
L2-classes:   (none)
Compose:      none
Autonomy:     n/a
Trust:        麦克风 OS/Chrome 权限；不写 auto_approve*
Channel:      community default (Web Speech)
```

- 音频流 **不**进 Companion、**不**进 history.db  
- 仅最终文本走 `chat.send` / 草稿  
- 设置默认：`voice_input_enabled=true` 但首次点 🎤 才 request 权限  

---

## 6. 波次（草案）

| 波次 | 内容 |
|------|------|
| M0 | 对抗 + dual-review |
| M1 | Web Speech + 🎤 + 草稿模式 + 设置开关 |
| M2 | auto-send 选项、lang、错误文案、telemetry 开关 |
| M3 | 可选 Companion STT（另开对抗） |

---

## 7. 开放问题（请对抗裁决）

1. 默认 **按住说话** vs **点按切换**？  
2. `voice_auto_send` 默认 false 是否强制？  
3. 子任务 composer 是否显示 🎤？  
4. Web Speech 不可用时：隐藏按钮 vs 灰显+说明？  
5. 是否需要 `audioCapture` manifest 权限？  
6. 与 continuous dictation 边界：v1 是否禁止 30s+ 长听？  

---

## 8. 攻击面（自报，供 Security 深化）

- 恶意页不能开 Side Panel mic（扩展上下文）  
- 但 **转写错误 → 用户未校就 auto-send** 可触发危险 tool 链路  
- 故 **auto-send 默认 off + 危险场景二次确认仍有效** 为补偿  

---

*End strawman — await Product / Security / Platform / Impl adversaries.*
