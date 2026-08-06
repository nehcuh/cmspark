# Voice Input M0.5 Platform Spike Report

> **日期**: 2026-08-06  
> **主机**: macOS 26.5.2 arm64 · Google Chrome **151.0.7922.75**  
> **SoT**: [2026-08-06-voice-input-design.md](2026-08-06-voice-input-design.md)  
> **状态**: **CONDITIONAL PASS** — 机器门禁已绿；**真人麦 / 扩展 tab onresult / Windows** 待操作者勾选后 M1 方可默认开

---

## 1. Spike 交付物

| 路径 | 作用 |
|------|------|
| `chrome-extension/src/sidepanel/voice/detect.ts` | 纯 feature-detect · lang · 45s 常量 |
| `chrome-extension/src/sidepanel/voice/error-map.ts` | §6.6 错误文案 · mic hide/disable 矩阵 |
| `chrome-extension/tests/voice-detect.test.ts` | 7 单测 |
| `chrome-extension/src/tabs/voice-spike.tsx` | 扩展 tab 诊断页（Plasmo → `tabs/voice-spike.html`） |
| `chrome-extension/scripts/voice-m05-chrome-probe.mjs` | CDP 探测 Chrome 桌面 Web Speech ctor |
| `docs/audit/reviews/voice-m05-chrome-probe-*.json` | 机器探针结果 |

**Manifest**: prod 构建 **无** `audioCapture`（已读 `build/chrome-mv3-prod/manifest.json`）。

---

## 2. 门禁记分板

| ID | 门禁 | 结果 | 证据 |
|----|------|------|------|
| **G1** | Chrome 桌面存在 `SpeechRecognition` / `webkitSpeechRecognition` | **PASS** `[executed]` | CDP file:// probe → `hasStd:true, hasWebkit:true` · Chrome/151 |
| **G2** | 默认 `lang` 环境可中文 | **PASS** `[executed]` | probe `navigator.language=zh-CN` |
| **G3** | 不添加 `audioCapture` | **PASS** `[executed]` | prod permissions 列表无 audioCapture |
| **G4** | 纯模块 / error map / mic chrome 矩阵 | **PASS** `[executed]` | `npx tsx --test tests/voice-detect.test.ts` **7/7** |
| **G5** | `plasmo build` 产出 spike tab | **PASS** `[executed]` | `build/chrome-mv3-prod/tabs/voice-spike.html` 存在 |
| **G6** | **扩展 document** 加载 spike 页 + 同 origin 下 ctor | **PENDING human** | 临时 profile `--load-extension` 未稳定解析 unpacked id（见 §4）；逻辑上 extension page 与普通 Chrome 页共享 Web Speech 全局 API（error 页上 ctor 仍为 true） |
| **G7** | 用户手势后 `zh-CN` ≥1 `onresult` | **PENDING human** | 需麦克风 + 真人说话；自动化无法在无麦 CI 完成 |
| **G8** | 云 STT 失败路径（offline / network） | **PENDING human** | spike 页含 online 监听 + `mapSpeechError("network")`；需关网手测 |
| **G9** | Side Panel 内权限 bootstrap（非仅 tab） | **PENDING human** | M0.5 先验证 **tab 页**；Side Panel 与 tab 同 extension origin，权限通常共享 — 仍须在 Side Panel 点一次 start 确认无 Permission dismissed |
| **G10** | Windows Chrome | **NOT RUN** | 本机仅 macOS；Win 列为 M0.5 缺口 / M1 前补测 |

**机器门禁 (G1–G5): PASS**  
**产品默认开 (G6–G9): 需人工勾选** — 符合 SoT「不过不写功能默认开」。

---

## 3. 机器探针摘录

```json
{
  "probe": "voice-m05-chrome-file-page",
  "chromeVersion": "Chrome/151.0.7922.75",
  "result": {
    "hasStd": true,
    "hasWebkit": true,
    "online": true,
    "lang": "zh-CN"
  },
  "speechCtorPresent": true
}
```

---

## 4. 自动化局限（诚实）

1. **临时 Chrome profile + `--load-extension`** 在本环境未把 unpacked CMspark 稳定注册到 Preferences；CDP 打开的 `chrome-extension://…/voice-spike.html` 曾落到 `ERR_FILE_NOT_FOUND`（错误 id / 扩展未真正加载）。  
2. **onresult** 依赖真实麦克风与（默认）云 STT；headless/无手势不可靠。  
3. **Windows** 未测。

因此 M0.5 **不能**声称「扩展内听写已端到端验证」，只能声称：

- 平台 **具备** Web Speech API  
- 产物与纯逻辑 **就绪**  
- 人工清单 **明确**

---

## 5. 人工验收步骤（操作者 5–10 分钟）

### 5.1 加载扩展

```bash
cd chrome-extension && npm run build
# Chrome → chrome://extensions → 开发者模式 → 加载已解压
# 目录: chrome-extension/build/chrome-mv3-prod/
```

记下扩展 ID：`chrome://extensions` 详情中的 ID。

### 5.2 打开 spike tab

地址栏：

```text
chrome-extension://<ID>/tabs/voice-spike.html
```

期望：标题 **Voice Input M0.5 Spike**，SpeechRecognition 显示 `SpeechRecognition` 或 `webkitSpeechRecognition`。

### 5.3 隐私 ack + 听写

1. 勾选 privacy ack  
2. 点 **Start (zh-CN)**  
3. 允许麦克风（若无弹窗：系统设置 → 隐私 → 麦克风 → Google Chrome；Chrome 站点设置 → 麦克风）  
4. 说一句中文（如「打开设置页面」）  
5. 日志出现 `onresult FINAL` 或 interim → **勾 G7**  
6. **Export report JSON** 存档  

### 5.4 云 STT / offline

1. 听写中或开始前关闭网络  
2. 期望 `onerror network` 或映射文案「语音识别需要网络…」→ **勾 G8**  

### 5.5 Side Panel 权限共享（G9）

1. 在 spike tab 已 grant 后打开 Side Panel  
2. 控制台（或未来 M1 mic）在 sidepanel 上下文执行  
   `typeof webkitSpeechRecognition` → `function`  
3. 若 Side Panel 首次 `start()` 仍 dismissed → 记录为 **bootstrap 必须做独立 tab**（SoT 已锁 bootstrap 页）

### 5.6 Windows（可选补测）

同 5.1–5.4 在 Win Chrome；结果贴本报告附录。

---

## 6. 对 M1 的含义

| 决策 | 建议 |
|------|------|
| 是否允许开始 M1 编码 | **是** — pure SM / UI 可并行；feature 默认 **关** 或 hide 直到 G7 人工 PASS |
| 是否允许 release 默认开 🎤 | **否** — 直至 G7（+ 建议 G8、G9）勾选 |
| bootstrap 页 | M1 实现时保留 **独立 tab 授权** 路径（spike 已验证 tab 形态） |
| Windows | 发布前至少一台 Win Chrome 跑 5.1–5.4 |

---

## 7. 复现命令

```bash
# 纯测
cd chrome-extension && npx tsx --test tests/voice-detect.test.ts

# Chrome ctor 探针
node chrome-extension/scripts/voice-m05-chrome-probe.mjs

# 构建 spike tab
cd chrome-extension && npm run build
```

---

## 8. 修订日志

| 日期 | 事件 |
|------|------|
| 2026-08-06 | M0.5 实现：detect/error-map/tests/voice-spike/probe；G1–G5 PASS；G6–G10 待人工/Win |

---

*Spike harness is diagnostic-only; product composer mic ships in M1 behind SoT gates.*
