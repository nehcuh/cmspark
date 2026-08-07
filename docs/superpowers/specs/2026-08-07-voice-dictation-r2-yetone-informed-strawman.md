# 语音听写 R2（yetone VoiceInput 对照）— 产品设计 Strawman（待对抗）

> **日期**: 2026-08-07  
> **状态**: STRAWMAN R2（**已废为对照**）— 合成见 [R2](../../audit/reviews/voice-dictation-r2-yetone-adversary-synthesis-20260807.md)；SoT 见 [听写+](./2026-08-07-dictation-plus-design.md)  
> **触发**: 用户要求参考 [yetone/voice-input-src](https://github.com/yetone/voice-input-src)（2.4k⭐；源码即一条 Claude 实现 prompt + dist 可复现构建）  
> **前置合成（R1，不得静默推翻）**:  
> [continuous-dictation-meeting-adversary-synthesis-20260807.md](../../audit/reviews/continuous-dictation-meeting-adversary-synthesis-20260807.md)  
> **前置 SoT**: M1 voice · Path B ADR-023 · R1 floors F-*-CD*  
> **关系**: 本 R2 **细化「LLM 纠错哲学 + 按住 HUD + 注入边界」**，不重开「会议 = 加长听写」；会议线仍独立。

---

## 0. 参考项目一句话（yetone VoiceInput）

> **macOS 菜单栏原生应用**：按住 Fn 录音 → Apple Speech 流式转写 → 可选 **极保守 LLM refine** → 剪贴板 Cmd+V 注入**当前任意聚焦输入框**；底部无边框胶囊 HUD（真 RMS 波形 + 实时字）。

仓库形态有趣点：`voice-input-src` **几乎只有 prompt**（用 Claude 生成完整 Swift 应用），`voice-input-dist` 为可构建产物——「产品规格即 prompt」。

---

## 1. yetone 可学习点（对照表）

| # | yetone 做法 | 对 CMspark 的启示 | R1 合成现状 | R2 草案倾向 |
|---|-------------|-------------------|-------------|-------------|
| Y1 | **Hold Fn → release inject** | 按住是主路径，不是设置深处的 Mode B | D2 热键、默认关、禁 fn 默认 | **形态吸收**；默认键仍平台否决 bare fn |
| Y2 | **底部全局胶囊 HUD** | 录制态必须「可见且优雅」；失焦仍有反馈 | F-UX-CD10 吵 REC + tray | **HUD 作为 Mode B / continuous 一等公民**，非仅 tray 点 |
| Y3 | **真 RMS 波形** | 假动画损害信任 | 仅 mic 脉动 | continuous/hold **优先真电平**（Side Panel 内或 HUD） |
| Y4 | **LLM = refine 非 rewrite** | system prompt 锁死：只修 ASR 错（谐音、配森→Python）；正确则原样返回 | P3 polish 默认 off；correct_only | **升级为产品核心**：默认 LLM 管线 = **ASR Refiner**，禁「润色/书面化」作默认文案 |
| Y5 | **松开后 Refining… 再注入** | 终稿一步，无边听边改 | P2 incremental off | **强化 R1**：只 final refine；禁止 incremental 改 draft |
| Y6 | **系统级注入任意输入框** | 系统听写竞品 | CMspark 主线程 composer only | **分轨**：CMspark 内 = composer；**系统级注入 = 非 v1 / 另产品或 Companion 能力** |
| Y7 | **剪贴板 + IME 切换** | 注入工程细节 | 我们 merge 进 textarea | Extension 内 **直接 setValue**；系统级才剪贴板 |
| Y8 | **Apple Speech 流式 + 中文默认** | browser/Web Speech 或系统 STT | browser \| local | 保持双引擎；refine 与 STT 解耦 |
| Y9 | **OpenAI-compat 可配** | 用户自带 LLM | 已有 Companion LLM | **复用 Companion 已配置 LLM**，不另开一套 API Key UI（可选高级覆盖） |
| Y10 | **规格即 prompt** | 实现前先锁「可执行规格句」 | 多 SoT/ADR | R2 附 **ASR Refiner system prompt 草案** 作 SoT 附件 |

---

## 2. CMspark 产品形态草案（R2 收敛）

### 2.1 三层能力（禁止糊成一层）

```text
L-A  Classic 听写（已上线 M1）
     点按 · ≤45s · 无 LLM · browser|local · 进 composer 草稿

L-B  Dictation+（yetone 对齐的「听写增强」）
     可选连续 / 可选按住 · 实时字 · 松手/点停 → ASR Refiner（可选）
     → 仍只进 **CMspark composer 草稿** · 无 auto-send

L-C  Meeting Scene（独立）
     会议工作台 · 长转写 · 纪要 LLM（**另一套 prompt**：结构纪要，非 ASR refine）
```

**yetone ≈ L-B 的 OS 原生版 + 系统注入**。CMspark 做 L-B **应用内版**，不复制成第二个系统听写，除非未来另开「Companion 全局听写」产品。

### 2.2 L-B 推荐用户旅程（yetone 对齐）

```text
[可选] 设置打开「连续听写」或「按住快捷键」
       + 可选「ASR 纠错（LLM）」开关（默认关 → 或对抗后默认开？ Q-REF1）

Mode A: 点 mic → 说话（连续）→ 点停
Mode B: 按住快捷键 → 说话 → 松开

共同:
  · 可见 HUD 或 Panel 内波形 + 实时转写
  · 停止 → 若 Refiner on: 显示「纠错中…」→ 仅 ASR 纠错结果
  · merge 进 composer · 用户可改 · 手点发送
```

### 2.3 与 yetone 的刻意差异（CMspark 身份）

| | yetone | CMspark L-B 草案 |
|--|--------|------------------|
| 注入目标 | 任意 App 焦点框 | **仅 Side Panel composer**（v1） |
| 宿主 | 独立 menu-bar app | Extension + Companion |
| 默认键 | Fn | **用户配置**；禁 Win+V；fn 仅 mac 可选（Platform 再裁） |
| STT | Apple Speech | browser Web Speech **或** Path B Whisper |
| LLM | 用户填 OpenAI-compat | **默认走 Companion 现有模型配置** |
| 成功定义 | 字出现在任意输入框 | 字出现在草稿且可发 Agent **但不 auto-send** |
| 会议 | 无 | L-C 独立 |

---

## 3. ASR Refiner — Prompt 哲学（R2 核心学习）

### 3.1 yetone 原意（摘自其实现 prompt）

> 非常保守地纠错：只修复明显的语音识别错误（中文谐音、英文技术术语被误转中文如「配森」→「Python」、「杰森」→「JSON」）。**绝对不要改写、润色或删除任何看起来正确的内容**；若输入看起来正确则**原样返回**。

### 3.2 CMspark system prompt 草案（可进 SoT 附件）

```text
You are an ASR post-editor for Chinese (and mixed EN) speech-to-text.
Your ONLY job is to fix obvious speech recognition errors.

ALLOW:
- Homophone / near-homophone Chinese fixes when context makes the intended word clear
- English technical terms wrongly rendered as Chinese syllables
  (e.g. 配森→Python, 杰森→JSON, 瑞艾克特→React, 库伯内提斯→Kubernetes)
- Broken punctuation that makes the sentence unreadable
- Accidental duplicate words from STT restart seams

FORBIDDEN:
- Rewriting for style, formality, or "better writing"
- Summarizing, expanding, or shortening meaning
- Adding content the user did not say
- Removing content that already looks correct
- Turning speech into tool calls, commands, or agent instructions
- Translating language unless the STT clearly garble-mixed scripts of the same term

If the input already looks correct, return it UNCHANGED (character-identical).
Output ONLY the corrected transcript text, no quotes, no explanation.
```

### 3.3 与「会议纪要 LLM」严格分流

| Job | Prompt 家族 | 输入 | 输出 |
|-----|-------------|------|------|
| **ASR Refiner** | 上表 · 保守 | raw STT 段/整段 | 同长度级修正文本 |
| **Dictation polish「书面化」** | **R2 建议砍出 v1** 或深埋 advanced | — | 高风险语义漂移 |
| **Meeting minutes** | 结构：TL;DR / 决议 / 待办 | 整场转写 | Markdown 纪要 · 禁臆造 |

---

## 4. HUD 产品草案（学习 yetone 胶囊）

### 4.1 何时出现

| 模式 | HUD |
|------|-----|
| classic ≤45s Panel 内 | Panel 内 mic 脉动即可；**可不**全局 HUD |
| continuous / hold | **必须**全局可见指示：Companion tray pulse **和/或** 底部胶囊 HUD |
| LLM refining | HUD/Panel 显示「纠错中…」 |

### 4.2 CMspark 实现选项（Platform 裁）

| 选项 | 说明 | 草案 |
|------|------|------|
| A Companion 原生 NSPanel 胶囊 | 最像 yetone；mac 优先 | **Mode B 推荐** |
| B Chrome notification / badge | 弱 | 不够 |
| C Side Panel 内加大波形 | Panel 打开时足够 | Mode A continuous 最低配 |
| D 系统 HUD + Panel 双开 | 冗余 | 避免 |

**R2 草案锁**：Mode B → **A 必需**；Mode A continuous 且 Panel 可见 → C 可接受；Panel 失焦 continuous → 升级 A 或强制 tray 强提示。

---

## 5. 热键与 Fn（R2 对照 yetone）

yetone 用 **CGEvent tap 吃掉 Fn**，专门防 emoji picker——这是 **纯原生 app** 能力。

CMspark：

| 平台 | yetone | CMspark R2 草案 |
|------|--------|-----------------|
| macOS | 默认 Fn hold | **可选高级**「尝试 Fn」；默认仍 **用户自选**（⌃⇧Space 等）；须 Accessibility |
| Windows | 无 | 用户自选；禁 Win+V |
| 注入 | 系统粘贴 | **不**做系统粘贴 v1 |

**不**因为 yetone 成功就推翻 R1「禁默认 fn」——yetone 没有 Chrome 扩展宿主约束。

---

## 6. 波次修订（在 R1 上叠加 yetone）

| 波次 | R1 | R2 调整 |
|------|----|---------|
| D1a | continuous browser + cap + REC | + Panel 内 **真波形可选**；**无** refine 也可先 |
| D1b | polish opt-in | **更名为 ASR Refiner**；prompt 锁 §3.2；**禁止「书面化」默认** |
| D1c | local 分段 | 不变 |
| D2 | hold hotkey | + **Companion HUD 胶囊**（yetone 级反馈）；热键控制面 |
| D3 | incremental | **取消或永停**（yetone 也不做边听边 LLM） |
| Mtg0/1 | 会议 | 不变；纪要 prompt ≠ Refiner |

---

## 7. 开放问题（R2 对抗必答）

| ID | 问题 | 草案默认 |
|----|------|----------|
| **Q-REF1** | ASR Refiner 默认 on 还是 off？ | **off**（费用+文本外发）；yetone 也是菜单可关 |
| **Q-REF2** | Refiner 失败是否注入 raw？ | **是**（与 R1 Q-LLM2） |
| **Q-REF3** | 是否允许 advanced「书面化」模式？ | **v1 不提供 UI**；仅 correct_only |
| **Q-HUD1** | Mode A continuous 是否强制全局 HUD？ | Panel 前台可仅 Panel 波形；失焦 >N s 升级 tray/HUD |
| **Q-HUD2** | Windows 无 Swift NSPanel 时 HUD 形态？ | Win：tray 气泡 + 可选小 Win32/overlay 后续 |
| **Q-INJ1** | 是否做「系统级注入任意 App」？ | **v1 否**；停车场「Companion Global Dictation」另对抗 |
| **Q-FN1** | mac 是否提供「Fn 按住」高级选项？ | **可 spike**；非默认；失败则隐藏 |
| **Q-LLM-CFG** | Refiner 用 Companion 默认模型还是独立小模型配置？ | **Companion 默认模型**；设置可显示「使用当前 LLM」 |
| **Q-MEET-X** | 会议是否复用 Refiner 再纪要？ | 转写可先 Refiner（可选）再 minutes job；两 job 串联明示 |

---

## 8. 攻击面自报（R2 新增）

1. **「保守 refine」prompt 被用户/Pack 覆盖** → 变成润色 Agent → Pack strip + prompt 服务端固定  
2. **Refining 时用户已开始打字** → 覆盖 → draft ownership（R1 F-UX-CD7）  
3. **系统级注入停车场被提前做** → 剪贴板窃取窗口 / 误粘贴密码框 → v1 禁  
4. **Fn tap 抑制** 在部分键盘/Globe 键 mac 上行为分裂 → 仅 spike 后提供  
5. **规格即 prompt 文化** 若直接把 yetone prompt 当实现 → 忽略 CMspark Trust/ADR → 必须映射 floors  

---

## 9. 成功标准（L-B yetone 对齐）

1. Hold 或 continuous 停止后，可选 Refiner：**谐音/术语类错误可测样本改善**；**正确短句 100% 原样**（回归测）  
2. Refiner on 时 UI 有「纠错中」；off 时零 LLM 调用  
3. 从不 auto-send；字只在 composer  
4. Mode B 录音时用户不看 Side Panel 也能感知在录（HUD/tray）  
5. classic 回归零破坏  

---

## 10. 请对抗输出

每位 agent：

1. Verdict  
2. 对 yetone **可抄 / 不可抄** 清单  
3. Floors 增量（F-*-R2*）  
4. §7 Q-* 全票  
5. 与 R1 合成冲突时 **是否修订 R1**（显式）  
6. 残余风险  

合成写入：`docs/audit/reviews/voice-dictation-r2-yetone-adversary-synthesis-20260807.md`
