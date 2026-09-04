# 语音输入 UX 重设计（Hex 式 push-to-talk + 状态反馈）

> GitHub: #258
> 日期: 2026-09-04 | 状态: Locked
> 相关: [ADR-023](../adr/023-voice-local-stt-path-b.md)（本地 STT 隐私门控，不放松）· [听写+ 设计](./2026-08-07-dictation-plus-design.md) · 参考实现 [Hex](https://github.com/kitlangton/Hex)（hotkey-semantics / TranscriptionIndicatorView / PasteboardClient）

---

## 1. 一句话

把语音输入从「一个麦克风按钮 + 横幅错误」升级为完整听写体验：push-to-talk 双模式、胶囊状态指示器（带电平呼吸）、状态音效、分级文本插入、转写后处理开关。**信任边界不动**（本地 whisper / browser 引擎现状，ADR-023 三级 ack 不放松）。

## 2. 交付范围（诚实分期）

本票交付（全部可验证）：
- PTT 双模式 + 误触丢弃
- 胶囊状态指示器（录音红/转写蓝/预热提示，电平呼吸）
- 状态音效（开始/停止/取消/完成，可关）
- 文本插入 tier-1（sidepanel 输入框，现状）+ tier-2（当前页聚焦输入框 DOM 直插）
- 转写后处理管线（语气词/词语映射/小写/去标点，**默认全关**）
- 模型选择器增强（星级/体积/语言范围标注 + 预热）

**不在本票（Phase 2 另票，先例 #69）**：
- tier-3 剪贴板快照 + 合成 Ctrl+V 插入
- tier-4 companion 原生 SendInput/UIA（浏览器外目标）——依赖 host-use 形态成熟后单独立项
- 流式部分转写（issue NEVER；Hex 也是批式）

## 3. 设计

### 3.1 Push-to-talk 双模式

- 现状：hold chord 已存在（`App.tsx:685-740` window 级 keydown/keyup，`hotkey-chord.ts` 默认 `Control+Shift+Space`）。本票在其上加模式判定，不改 chord 解析与禁用表（禁 fn、禁 Win+V 单组合维持）。
- **按住说话**：按住 ≥300ms 松开 → 正常停止并转写。**误触**：按住 <300ms 松开 → 静默丢弃（不转写、不留痕迹、不报错）；新常数 `VOICE_PTT_ACCIDENTAL_MS = 300`。
- **双击锁定**：300ms 内按下-松开-再按下（第二次按下视为锁定开始）→ 锁定录音，解放双手；再按一次 chord 或 ESC 结束。新常数 `VOICE_PTT_DOUBLE_TAP_MS = 300`。
- 锁定态与 hold 态的 UI 区分：锁定态胶囊显示「已锁定 · 再按结束」。

### 3.2 胶囊状态指示器

- 位置：sidepanel 输入框上方悬浮胶囊（不动现有 VoiceMicButton，它是入口不是状态显示器）。
- 状态映射（接 `useVoiceInput` 既有 `phase`）：listening → 红色胶囊 + 电平呼吸；processing/stopping/refining → 蓝色流光；starting（本地引擎模型冷启）→ 「预热中…」提示；error → 既有横幅（不重复造）。
- **电平接线**：`audio-capture.ts:14` 的 `onLevel`（AnalyserNode RMS 0–1）与 `pcm-stream-capture.ts:17` 已存在但无消费者——本票把它们接到胶囊呼吸动画（scale/opacity 随电平）。浏览器引擎路径无 PCM 电平（Web Speech 不给音频流），胶囊用匀速脉冲并标注差异（不假装有电平）。
- a11y：胶囊状态进 aria-live（复用 VoiceMicButton 的 visually-hidden 模式）。

### 3.3 状态音效

- WebAudio 合成短音（不引音频资源文件，包体积零增长）：start（升调）/ stop（降调）/ cancel（低短促）/ done（双音）。常数表给频率/时长，可测。
- 设置开关 `voice_sound_effects`（默认**开**，Hex 默认亦有声；可一键关）。听写隐私 ack 弹窗期间不发声。

### 3.4 文本插入分级

- tier-1 sidepanel 输入框：现状（`onDraft` → setText + focus），不变。
- tier-2 页面聚焦输入框：PTT chord 在页面（content script）捕获时生效——**这是新建注入面**（仓库当前无 `contents/`、Plasmo manifest 无 `content_scripts`；`host_permissions` 已有 `<all_urls>`，不新增权限，但要新增一个 content script 条目，实现 PR 必须如实声明）：content script 侧监听同一 chord（页面 focus 在可编辑元素：input/textarea/contenteditable），转写完成后 `Input.insertText`（background/browser-bridge.ts:1021 既有 CDP 路径）直插光标处。页面无可编辑焦点时落到 tier-1 并在胶囊提示「已插入侧栏输入框」。
- 触发面判定：chord 事件发生在哪个上下文（sidepanel window vs 页面 content script）决定目标，不需要用户选择。
- **开关默认**：PTT 双模式跟随既有听写热键开关 `dictationHotkeyEnabled`（默认 `false`，agentStore.tsx:617）——本票**不改默认值**，用户在设置里开启热键后双模式生效；设置项文案说明双模式语义。
- 权限：不新增 host 权限。

### 3.5 转写后处理管线（默认全关）

- companion 侧 `voice.stt.result` 发出前过管线（纯函数，可单测）：语气词表去除（中英各一份常数表）、用户词语映射（设置里可编辑的 `[[from, to]]` 表，如「Kubernetes」大小写校正）、小写开关、去尾部标点开关。
- 四个开关独立，默认全关——**不偷偷改用户的话**是诚实底线；开启后处理在结果气泡带「已后处理」微标。
- 管线只作用 final 结果，不动 interim。

### 3.6 模型选择器增强

- 设置语音面板模型卡片加：星级（准确度/速度两维，常数表写死在 whisper-settings-copy 侧）、体积（manifest size 已有）、语言范围（multilingual / en-only 从 catalog 派生）。
- 预热：活动模型 ready 且设置 `voice_model_prewarm`（默认关）开时，companion 启动后后台 load 一次模型——首次听写不卡。预热失败静默回退（下次听写照常冷启），只在模型卡片显示「预热失败」微标。

## 4. 常数表

| 常数 | 值 | 含义 |
|------|----|------|
| `VOICE_PTT_ACCIDENTAL_MS` | 300 | 误触丢弃阈值 |
| `VOICE_PTT_DOUBLE_TAP_MS` | 300 | 双击锁定窗口 |
| `VOICE_SFX_*` | 见实现 | 音效频率/时长表（start/stop/cancel/done） |
| `LOCAL_STT_MAX_RECORD_MS` | 45000（既有，不动） | 录音硬顶 |

## 5. 未完成时禁止假装

- 误触丢弃不得产生任何转写/UI 痕迹（包括「取消」音效都不放——静默）。
- 浏览器引擎路径不得假装有电平（匀速脉冲 ≠ 电平呼吸，可区分）。
- 后处理默认全关；开启必须在结果可见标注。
- tier-2 插入失败（页面不可编辑/焦点丢失）必须落 tier-1 并提示，不得丢文本。
- 不碰 ADR-023 三级 ack 门禁；不引入云端 STT。

## 6. 测试

- PTT 状态机：hold / 误触 / 双击锁定 / ESC 解锁四条路径单测（session-reducer 或新 ptt-reducer 纯函数）。
- 胶囊：phase→视觉映射单测；电平回调接线 source-pin + mock 电平驱动。
- 音效：开关门 + 各状态触发计数（WebAudio mock）。
- 后处理管线：四条规则各正反例；默认关时零改动断言。
- tier-2：content script chord 捕获 → 插入目标的判定单测；失败回落 tier-1。

## 7. Blast（沿用票面 T2）

Surface: sidepanel + content script；L2-classes 不变（voice/* 既有）；Autonomy 用户主动触发；Trust 不变；Channel 既有 WS + content script 消息。

## 8. 不在本票

- tier-3/4 插入（Phase 2 另票）
- 流式部分转写（issue NEVER）
- 全局系统级热键（sidepanel/页面焦点外不生效，Hex 的全局热键依赖原生 companion 形态，另议）
