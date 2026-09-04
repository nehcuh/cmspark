# Windows 系统语音识别兜底（SAPI / WinRT SpeechRecognition）

> GitHub: #259
> 日期: 2026-09-04 | 状态: Locked
> 相关: [ADR-023](../adr/023-voice-local-stt-path-b.md) · 现状 `chrome-extension/src/sidepanel/voice/web-speech-adapter.ts` · `companion/src/voice/`

---

## 1. 一句话

Windows 上本机 whisper 模型未下载且浏览器 Web Speech 不可用（Google 服务不可达）时，自动落到 **Windows 系统自带语音识别**，语音输入永远可用。音频不出本机（系统本地识别，非云端）。

## 2. 现状与缺口

- `SttEngineKind = "browser" | "local"` 严格二选一（whisper-handlers.ts:555 校验）。
- `autoFallbackToBrowser`（useVoiceInput.ts:78-92）只覆盖 local→browser 的本会话回退；browser 依赖 Google 网络服务，不可达网络 100% 失败——此时语音输入完全不可用。
- 既有原生集成先例：tray 的 systray2 外部二进制桥（tray-adapter.ts:177）、whisper win-x64 二进制下载（binary-resolve.ts:21）、launcher smoke 已在 windows-latest CI 跑 csc 编译 stub（#279）。

## 3. 设计

### 3.1 第三引擎 `"system"`

- `SttEngineKind` 增加 `"system"`（仅 win32 可选；非 Windows 平台设置里不显示该选项，配置里出现该值在非 win32 fail-closed 回 browser）。
- 引擎链语义（Windows）：`local`（whisper 就绪）→ 不就绪且 autoFallbackToBrowser → `browser` → browser 失败（network/service-not-allowed）且平台 win32 → `system`。**每级回退都有可见提示**：落到 system 时横幅「已使用 Windows 系统语音识别」（与 LOCAL_FALLBACK_BROWSER_BANNER 同模式，新常数文案）。
- `system` 也可在设置里直接选为主引擎（用户主动选择权）。

### 3.2 companion 原生 helper（SAPI via .NET System.Speech）

- 新增 `companion/src/voice/win-sapi-helper.cs`：System.Speech.Recognition（.NET Framework 自带，Windows  inbox，零下载）做批式听写——stdin/stdout 行 JSON 协议（tray `hud/protocol.ts:4` 同款）：收 `{ wav_path, lang }` → 回 `{ text }` 或 `{ error }`。
- 编译：打包期 `csc.exe`（Windows 自带）编译为 `win-sapi-helper.exe`，产物 sha256 记进打包清单；**不经 PATH 解析未知二进制**（ADR-023 L5 精神：helper 路径固定在 companion 安装目录，sha256 启动校验）。build-windows-exe.ps1 加编译步骤；源码进仓库，任何人可复编。
- 运行时：companion 起子进程喂 16kHz mono WAV（audio-capture 既有产物），45s 硬顶沿用 `STT_MAX_RECORD_MS`；helper 超时/崩溃 → `voice.stt.error`（system_engine_failed）+ 诚实文案。
- 语言：跟随听写语言设置（zh-CN / en-US 映射到 recognizer culture；系统无该 culture 时诚实报错「系统语音识别不支持当前语言」）。

### 3.3 设置可见性

- 设置语音面板新增「引擎链路状态」区：本机模型（ready/absent/downloading）/ 浏览器听写（available/unavailable+原因）/ 系统语音（available：win32 且 helper 就绪；unavailable+原因）。三行状态全部来自真实探测，不缓存假装。
- 探测：companion `voice.system.state` 新消息——win32？helper 存在且 sha256 通过？System.Speech 可用（helper 自检命令 `{"probe":true}`）？

### 3.4 验证限制（诚实声明）

开发机是 macOS，**本票功能无法在本机运行验证**。门禁改为：
- windows-latest CI smoke：csc 编译 helper + 行 JSON 协议 echo 测（合成 WAV 静音文件跑通识别管道，不断言识别内容）。
- PR 附 on-Windows 人工验证清单（先例：#69 host-use Phase 2）。
- 合并后第一张 Windows 实测反馈票优先处理。

## 4. 常数表

| 常数 | 值 | 含义 |
|------|----|------|
| `STT_MAX_RECORD_MS` | 45000（既有，沿用） | system 引擎同一硬顶 |
| `SAPI_HELPER_TIMEOUT_MS` | 15000 | helper 单次识别超时（不含录音） |
| `SAPI_HELPER_SHA256` | 打包期生成 | helper 启动校验 pin |

## 5. 未完成时禁止假装

- 「浏览器回退」不算完成（issue 明文）；只做 mac 路径不算完成。
- 非 Windows 平台不得在设置里显示「系统语音」可用。
- helper 缺失/校验失败必须诚实报「系统语音识别不可用」，不得静默掉到 browser（用户已在 browser 失败路径上）。
- 音频不出本机：System.Speech 本地识别；**禁止**切到 Windows 在线识别 API。

## 6. 测试

- 引擎链状态机单测（local/browser/system 各级回退条件与文案；非 win32 fail-closed）。
- helper 协议单测（行 JSON 编解码、超时、错误帧）。
- windows-latest CI smoke（编译 + 静音 WAV 管道）。
- 既有 autoFallbackToBrowser 行为回归（不改变默认，issue NEVER）。

## 7. Blast（沿用票面 T2）

Surface: companion native helper（win32 only）；L2-classes: voice/system-*（复用 voice.stt.* 会话管道，不新增 L2 工具）；Trust: 音频不出本机；Channel: 既有 WS。

## 8. 不在本票

- macOS NSSpeechRecognizer（mac 有 whisper Homebrew 路径，issue NEVER）
- 云端 STT；改变 autoFallbackToBrowser 默认
- 流式识别（System.Speech 批式即可，与 Hex 式批式一致）
