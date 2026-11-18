# 聊天语音输入的外部转写

> GitHub: #860
> 日期：2026-11-18
> 状态：修订稿已于 2026-11-18 被用户批准。节点 0 评审返修仍在文档内：时钟分开、截断按 PCM 对齐、校验与水合、分帧不进本机 2.5 MB。本地识别优化只记在第 12 节，本 PR 不改本地代码，也不做用户机器测量。实施计划见 `docs/superpowers/plans/2026-11-18-external-chat-asr.md`。计划的独立评审通过之前不改产品代码。本轮不改版本号、tag 或 Release。
> 基线：`main` `55f82f93434b4d1dc6edf69412b16cbbdf923434`（v1.2.0）。
> 范围来源：用户已选择「DeepSeek 原生 ASR + OpenAI 兼容音频转写；只做聊天语音输入」。确认本文件之前，不进入实施。
> 形状参考：用户本机 Newton `f93735b934119b99864ec476f90a6dad0190f05e` 的脱敏摘要。只借用接口分叉，不移植 Obsidian 插件、`ScriptProcessor`、osascript 或 `data.json` 存密钥。Newton 摘要没有核过线上接口；下面的 DeepSeek 合同以 2026-11-18 抓到的官方文档为准。

## 1. 产品行为

聊天输入增加第四种听写方式：「外部转写」。浏览器听写、本机 Whisper、Windows 系统语音保持原样，仍可选择。

用户在设置里选定一种接口风格，填写该风格自己的地址和密钥。OpenAI 风格还要填写模型名。这些字段不从聊天模型配置复制。地址留空时用该风格的官方默认主机，不用聊天 Base URL。密钥留空时不能开始外部转写。

聊天里按下麦克风只在本机录音。再按一次是「停止并转写」。录音先到该风格的时长或文件大小时，同样停在已录片段上并转写这一段，不静默丢掉，也不自动再录一段。Companion 只把这一段发到已保存的地址，把返回的文字放进输入框。录音过程中取消，不发请求。上传已经开始后取消，停止等待并丢掉迟到结果；界面说明这段音频可能已经到达对方服务器。

失败、断线、关闭面板、切换听写方式，都不改写已保存的引擎，不自动改用浏览器或本机，不自动再发一次付费请求。

会议转写不走这条路。引擎是外部转写时，会议给出明确说明，不上传会议音频。

本设计不承诺中文准确率或速度优于本机 Whisper。那要等用户用自己的真实录音比较。完成的标准是：请求按配置发出，文字或诚实的错误回到输入框。

## 2. 已锁定的取舍

这三项不再留给实现时选择。

1. **首版不提供「复用聊天地址 / 密钥」。** 外部转写始终使用自己的风格、地址和密钥。聊天配置只继续服务聊天和下面第 8 节的文本纠错。少一个开关，避免把 DeepSeek 聊天地址拼进 `/v1/tools/asr`，也避免把聊天密钥发给另一个转写主机。
2. **两种风格上传同一种音频，但外部录音预算独立于本机 45 秒。** 格式仍是 16 kHz、16-bit、单声道 PCM WAV，不做第二套 webm/opus。停录点是该风格的时长上限和文件大小上限里先到的一个。到点后保留已录片段，发一次转写，不丢、不自动切成多段。browser / local / system 的 45 秒不变。
3. **保存配置不发网络请求，没有「兼容」绿标。** 官方没有免费的兼容性探测。用静音或真录音做探测都会产生费用，而且不能证明中文效果。第一次真正的请求就是用户停止录音之后的那一次。

文本纠错沿用现有开关，不新增开关。默认仍然关闭。见第 8 节。

## 3. 不在本设计内

- 会议实时转写、会议文件导入、说话人分离、热词、转写 prompt。
- 流式 ASR、边说边上传、按片段多次付费。
- 自动重试，或失败后改走浏览器、本机、系统语音、另一个云端。
- 复用聊天密钥或聊天 Base URL，包括一个默认关闭的复用开关。
- 把密钥放进系统钥匙串，或声称磁盘上的密钥已被 cmspark 加密。
- 扩大默认 outbound profile，新增工具确认方言，或改 Agent 运行时。
- 本机 Whisper 的加速、预热、模型、语言参数和重复解码。顺序与验收在第 12 节。本 PR 不改这些代码，也不在用户机器上测量。未测量之前，不把主观的慢说成这台机器的原因。
- 发版、改版本号、放宽测试超时、失败后盲目重跑整条 CI。

## 4. 现有链路（基线，本设计不改其行为）

`voice.sttEngine` 今天只有 `"browser" | "local" | "system"`，默认 `"browser"`（`companion/src/config.ts` 176–214、611–616 行）。引擎写入 `~/.cmspark-agent/config.json`。该文件与数据目录保持 owner-only：目录 `0o700`，文件 `0o600`（同文件 772–786 行）。这是文件系统权限，不是钥匙串，也不是加密。

- 浏览器：`chrome-extension/src/sidepanel/voice/web-speech-adapter.ts`，音频不到达 Companion。
- 本机：侧栏采 16 kHz 单声道 WAV（`audio-capture.ts` 第 2–4 行；`local-stt-detect.ts` 29–33 行），经 `voice.stt.start` / `chunk` / `end` 交给 Companion。Companion 调用 `whisper-cli`，参数含强制 CPU 的 `-ng`（`whisper-runner.ts` 60–86 行）。
- 系统语音：仅 Windows。非 Windows 加载时改回 browser（`config.ts` 1068–1072 行）。

预算（`companion/src/voice/session-caps.ts`）：单段录音 45 秒，块间隔空闲 10 秒，整段推理 90 秒，单块 256 KiB，单会话原始字节 2_500_000。侧栏等本机结果 95 秒（`local-stt-adapter.ts` 第 72 行）。这些数字只继续约束 browser、local 和 system。外部转写不得读取它们来截断录音、拒绝合法体积或缩短等待。单块 256 KiB 可以继续当作传输切片，但它不是一句的结尾。

模型未就绪时，现有 `autoFallbackToBrowser` 可以让**这一次本机听写**改用浏览器并出横幅，且不改 `sttEngine`（`useVoiceInput.ts` 1–7、88–101 行）。外部转写不进入这条回退。

`voice.model.state` 不下发任何密钥（`whisper-state.ts` 42–72 行）。聊天密钥在离开 Companion 前变成 `"***"` 或空串（`config-redact.ts` 21–36 行）。外部密钥走同一条红线，并且不进入 `user-env.json`。`user-env.json` 仍只服务技能进程环境（ADR-019）。

ASR 纠错是转写完成之后的文本请求，使用聊天模型，不上传音频（`asr-refiner.ts` 1–11 行；`useVoiceInput.ts` 354–373 行）。默认关闭。

仓库里没有 `audio/transcriptions` 或 `/v1/tools/asr` 的客户端。

## 5. 配置

### 5.1 字段

`sttEngine` 增加 `"external"`。新增对象 `voice.external`，与聊天 `llm` 并列，不嵌在 `llm` 里：

| 字段 | 类型 | 含义 |
|---|---|---|
| `style` | `"deepseek"` 或 `"openai"` | 决定路径和表单。首次把引擎设为 external 时默认 `"deepseek"`。 |
| `baseUrl` | 字符串 | 用户填写的转写地址。空字符串表示使用该风格的默认主机，不是聊天地址。 |
| `model` | 字符串 | 只对 openai 风格发送。deepseek 风格保存但不发送。 |
| `apiKey` | 字符串 | 只存在 Companion 进程和 `config.json`。 |
| `maxDurationMs` | 数字或空 | 外部录音时长上限。空只允许 openai 风格，表示不再另加时长上限。 |
| `maxBytes` | 数字 | 外部 WAV 文件上限，含 44 字节头。和时长谁先到谁停录。 |
| `requestTimeoutMs` | 数字 | POST 开始后的上传加服务端处理等待。与录音上限无关。 |

默认引擎仍是 `"browser"`。升级已有配置时，没有 `voice.external` 就补上 deepseek 的出厂预算：`maxDurationMs` 120000、`maxBytes` 8388608、`requestTimeoutMs` 180000，外加 `{ style: "deepseek", baseUrl: "", model: "whisper-1", apiKey: "" }`。非法 `sttEngine` 继续按今天的规则收回 `"browser"`。补字段不改变用户当前引擎。

`model` 的出厂可见值是 `whisper-1`。用户把风格改成 openai 时，输入框里已经能看见这个值，可以改完再保存。它不是隐藏的第二次默认。deepseek 风格的设置页不显示模型框。

### 5.2 地址规范化

保存和真正发请求时使用同一函数。拒绝则不写配置。去掉首尾空白。拒绝用户信息（`user:pass@`）、查询串、片段、非 http(s) scheme。

**deepseek**

- 空地址的默认主机是 `https://api.deepseek.com`。
- 路径末尾的 `/` 去掉。
- 路径正好是 `/v1/tools/asr`：原样使用。
- 路径是空、`/` 或正好 `/v1`：结果为该主机上的 `/v1/tools/asr`。正好 `/v1` 先去掉这一个后缀，再接上 `/v1/tools/asr`，所以 `https://api.deepseek.com/v1` 变成 `https://api.deepseek.com/v1/tools/asr`。
- 其它路径拒绝，包括 `/v1/v1`、`/v1/chat/completions`。不把 ASR 路径接到聊天路径后面。

**openai**

- 空地址的默认主机是 `https://api.openai.com/v1`。
- 路径末尾的 `/` 去掉。
- 路径已经以 `/audio/transcriptions` 结尾：原样使用。
- 其它路径把 `audio/transcriptions` 接在现有路径之后。`https://api.openai.com/v1` 变成 `https://api.openai.com/v1/audio/transcriptions`。`https://example.test/openai/v1` 变成 `https://example.test/openai/v1/audio/transcriptions`。
- 不自动补一个缺失的 `/v1`，也不在已有 `/v1` 前再加 `/v1`。

两种风格都不是「凡是 OpenAI 兼容聊天地址就能转写」。聊天完成和音频转写是两条路径。设置页在 openai 风格下写明：这里要填的是提供 `/audio/transcriptions` 的地址，聊天 Base URL 通常不是它。

### 5.3 主机限制

用户明确填写的本机服务必须能保存。过度的公网白名单不在本设计里。

- `https`：允许用户写下的主机名、公网 IP、回环和 RFC1918。字面地址若落在链路本地 `169.254.0.0/16`、`fe80::/10`、`0.0.0.0/8`、未指定地址或组播，保存时就拒绝，不限于 `http`。主机名在 POST 前做一次 DNS。任一结果落在上述范围，或解析失败、没有地址，就不发请求，码为 `external_unreachable`。解析到回环或 RFC1918 仍允许。这一次检查只看当时的解析结果，不把后续连接绑到这些地址，因此不能说已经消除 DNS 重绑定。
- `http`：只允许主机名 `localhost`，或字面 IP：`127.0.0.0/8`、`::1`、RFC1918（`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16`）、IPv6 唯一本地 `fc00::/7`。其它 http 主机名拒绝，避免先写成公网名字、再解析到云元数据地址。
- 自定义端口允许。
- 重定向不跟随。Node `fetch` 使用 `redirect: "error"`。收到 3xx 就是失败 `external_redirect`，不把同一份音频和密钥发到第二个主机。

密钥只放在这一次 POST 的 `Authorization: Bearer` 头里。不写入 URL，不写入 `user-env.json`，不随聊天请求发送，不放进子进程环境。

### 5.4 保存、水合、清空

设置页经现有 `voice.model.*` 通道保存，不把密钥放进 `chrome.storage.local`。

- 请求里 `apiKey` 缺省或正好是 `"***"`：保持已存密钥。
- `apiKey` 是空字符串：清空已存密钥。
- 其它非空字符串：替换已存密钥。
- 地址、风格、模型非法：整次保存拒绝，已存字段都不变。openai 风格的 `model` 去掉空白后为空，属于非法。deepseek 风格不读取输入框里的模型，已存的 `model` 保持不动。
- 时长、体积、请求超时超出第 6.1 节的允许范围：整次保存拒绝。deepseek 不能高于文档上限。openai 不能高于本进程的内存保护线。低于 1 秒或非整数同样拒绝。
- 同一次保存若改变 `style`，未同时给出新预算时，改用新风格的出厂预算，不把 deepseek 的 120 秒留在 openai 上，也不把更大的 openai 体积留在 deepseek 上。用户在同一次保存里写下的合法预算则采用用户的数字。
- `voice.model.set_engine` 设为 `"external"` 时，规范化地址必须合法，且已存密钥非空，且本次带 `privacy_ack_external_v1: true`。否则拒绝，`sttEngine` 保持原值。这和今天「没有就绪模型就不能切到 local」同一形状（`whisper-handlers.ts` 第 7、865 行）。

`voice.model.state` 增加：

```text
sttEngine: "browser" | "local" | "system" | "external"
external: {
  style: "deepseek" | "openai"
  baseUrl: string          // 用户填写的原文，不是密钥
  normalizedUrl: string    // 规范化后的完整 URL，无查询、无用户信息
  model: string
  keyConfigured: boolean
  maxDurationMs: number | null
  maxBytes: number
  requestTimeoutMs: number
  limitNote: "deepseek-docs" | "openai-file-cap" | "unprobed-local-default"
}
```

`limitNote` 只说明上限的来源，不表示已经连上服务器。用户把 openai 官方主机的体积调低后，来源仍是 `openai-file-cap`。

状态里没有 `apiKey`。`config.get` / `config.updated` 若带上 `voice.external`，`apiKey` 非空则是 `"***"`，空则是 `""`。红线加在 `redactConfigForWire`。日志不打印密钥、`Authorization`、音频字节或转写正文。允许记录风格、主机名、状态码、字节数、耗时和错误码。

Companion 未连接时，侧栏可以显示上一次状态里的 `keyConfigured`，但不能开始外部录音，也不能在本地排队等重连后补传。断线期间的缓冲丢掉。

语音设置继续是 Companion 全局配置，不按项目、会话或工作区拆分。项目切换不改变外部转写配置，也不触发上传。

## 6. 录音与请求

### 6.1 外部预算

聊天外部转写复用现有 16 kHz、单声道采集，并在发出前确认是 16-bit PCM WAV，文件名 `audio.wav`，内容类型 `audio/wav`。两种风格同一份文件。这种 WAV 每秒 PCM 为 16000 × 2 = 32000 字节，另加 44 字节头。

本机 45 秒、2_500_000 字节、90 秒推理和侧栏 95 秒等待不应用到 external。按这个 WAV，45 秒只有 1_440_044 字节，120 秒已有 3_840_044 字节，会先被旧的会话字节上限挡住。外部会话使用自己的数字。256 KiB 只是 WebSocket 上的一块，一块写满不结束录音。`voice.stt.partial_request` 在 external 上忽略，避免一段话变成多次付费请求。

停录时比较两件事，谁先到停谁，并保留已录的 PCM，编码成一份 WAV，然后进入同一次 `end`。不丢掉前缀，不自动按静音再切一段。

| 名字 | 管什么 | 不管什么 |
|---|---|---|
| `maxDurationMs` | 麦克风打开后的墙钟。到点停录并转写已录片段 | 上传要多久、服务端还要算多久 |
| `maxBytes` | 即将生成的 WAV 字节。下一块 PCM 越过上限时只收下界内的对齐字节 | 本机 2_500_000 的旧会话上限 |
| 块间隔 | 录音中连续 15 秒没有下一块。这是管道断了。已录片段不上传，并说明没有发送 | 说话中的停顿。停顿仍有 PCM 块 |
| `requestTimeoutMs` | POST 开始之后，上传和等响应共用的截止时间。到点 abort | 录音时长 |
| 侧栏等待 | `requestTimeoutMs` 加 10 秒，只等这一次 external 结果 | 本机 95 秒 |
| 内存保护 | 一个聊天外部会话在 Companion 里最多留 32 MiB（33_554_432 字节）的 WAV。这是进程保护，不是服务商上限 | 会议缓冲 |

到点文案只有两句，并接着「正在转写已录的这一段」：

- 时长先到：「已到录音时长上限。」
- 体积先到：「已到文件大小上限。」

停录决定的输入是已经收下的 WAV 字节，加上下一块候选 PCM 字节。16-bit 单声道按 2 字节对齐，44 字节头不算 PCM。保留字节等于 44 加已接受的对齐 PCM，并且必须小于或等于生效上限。生效上限是体积对齐后的字节，和时长换算出的 WAV 字节里更小的那个；时长为空时只有体积。候选块越过哪几道线，原因就是哪几道：只越过时长、只越过体积，或同一块里两道都越过。已经大于上限的已提交字节要裁回这个对齐上限，不能原样返回。裁完的前缀进入一次转写。两道都越过时两句文案都显示。用户若还想说后面的话，要再按一次麦克风，那是他自己开始的另一次请求。

**deepseek。** 2026-11-18 的 [Speech to Text](https://api-docs.deepseek.com/guides/asr/) 写明：最长 120 秒，最大 8 MiB，上传须在 10 分钟内完成。8 MiB 按 8 × 1024 × 1024 = 8_388_608 字节。出厂 `maxDurationMs` 是 120000，`maxBytes` 是 8388608。保存时不能更高。可以调低，最短 1000 毫秒，最小体积 32044 字节（1 秒 PCM 加 WAV 头）。这种 WAV 的 120 秒是 3_840_044 字节，先到时长，到不了 8 MiB。8 MiB 仍要校验，因为实现若改了采样率就不能只信 120 秒。`limitNote` 为 `deepseek-docs`。

**openai，主机规范化后正好是 `api.openai.com`。** 2026-11-18 的 [File transcription](https://platform.openai.com/docs/guides/speech-to-text) 写「Files can be up to 25 MB」，后文又写转写 API 接受最多 25 MB 的文件，更大的文件要换压缩格式或拆开。同页的 10 分钟代码是拆文件的例子，不是写明的最长秒数。Create transcription 参考页也没有统一的最长秒数。因此出厂 `maxBytes` 是 25_000_000（按十进制 MB，不把文档没有写的 25 MiB 当成上限），`maxDurationMs` 为空。空时长表示只按体积停。`limitNote` 为 `openai-file-cap`。设置页写明：这是 OpenAI 官方文件上限，不是对你的账号做过探测，也没有官方时长可填。用户可以加上时长，或把体积调低。体积不能高于 25_000_000，也不能高于下面的内存保护线。

**openai，其它主机。** 兼容网关和本机服务没有一份共同的官方时长或体积。cmspark 不发探测请求，也不把 OpenAI 的 25 MB 说成对方的上限。出厂仍是 `maxBytes` 25_000_000、`maxDurationMs` 为空，但 `limitNote` 为 `unprobed-local-default`。设置页写明：这是本机默认停止线，避免一次聊天录音占用过多内存；不知道对方允许多大、多长。用户把体积调到 32044 与 33_554_432 之间，时长可以留空或设为 1000 到 1_800_000 毫秒。留空时只按体积停。

33_554_432 字节（32 MiB）是 Companion 进程对这一次聊天录音的内存边界，不是任何服务商的上限，也不是「可以无限录音」。保存更大的 `maxBytes` 会被拒绝，设置页显示错误，配置保持原值；不会悄悄截短已保存的数字，也不会假装对方接受任意大小。32 MiB 的 16 kHz PCM 大约是 (33_554_432 − 44) / 32000 ≈ 1048.6 秒。需要更长的一段时，本设计不自动拆段，也不改成会议。OpenAI 官方主机另外不能超过文档中的 25_000_000 字节，那一道更紧，仍然是可见拒绝。

`requestTimeoutMs` 出厂 180000，允许 30000 到 600000。600000 只是客户端对整次 POST 的最长等待：从开始上传正文算到响应结束，到点 abort。它不代表 DeepSeek 的上传时限，也不是识别时限。该文档里「上传须在 10 分钟内完成」只解释 HTTP 408。HTTP 504 是识别超时。408 和 504 都映射为 `external_timeout`，不自动重试。openai 风格没有对应的官方客户端时限；那里的 600000 同样只是本客户端愿意等的最久。

设备采样率低于 16 kHz 时，沿用现有重采样。不新增「保持 8 kHz」的编码器。DeepSeek 还接受 Ogg Opus 和其它 WAV 采样率；本设计只发上述 WAV，不发语言字段。OpenAI 文档中的输入格式包含 wav。2026-11-18 的同一指南把 `gpt-transcribe` 列为推荐模型，并写 `whisper-1` 将于 2027-02-26 关闭。已保存的可见默认仍是 `whisper-1`，不在这次修订里自动改掉；用户可以改成指南里的当前模型名。

### 6.2 会话

继续使用 `voice.stt.start`、`voice.stt.chunk`、`voice.stt.end`、`voice.stt.abort`。Companion 只相信已保存的配置。扩展传来的地址、密钥或模型不能覆盖它。`start` 里的 `engine` 必须是 `"external"`，且与已保存的 `sttEngine` 一致，否则拒绝，不建会话。

`start` 还要带 `privacy_ack_external_v1: true`。只有 `privacy_ack_v2: true` 不能授权这次外发。Companion 再查一次引擎、密钥和地址。缺任一条件就拒绝。`voice.stt.start` 在 `engine` 为 `external` 时不要求 Whisper 的 `modelId`，也不把 `maxMs` 限制在 45000。local 与 system 的原校验不变。加载配置时 `sttEngine: "external"` 必须保留；缺 `voice.external` 只补第 5.1 节的默认对象，不把原来的 browser、local 或 system 改掉。

现有三道本地栅栏不能裁外部长录音。`companion/src/ws/lifecycle.ts` 的单帧上限是 10 MiB。`voice.stt.chunk` 的解码上限是 256 KiB。`stt-session-core.ts` 的 `appendChunk` 在累计超过 2_500_000 字节时拒绝。外部的 chunk、end 和 abort 不进入 `appendChunk`。每一块解码后不超过 256 KiB，多块顺序写入临时文件。整段 WAV 不放进一条 WebSocket 消息。25_000_000 与 33_554_432 是停录和保存的边界，不是把整段塞进一帧。扩展只保留正在发送的那一块。Companion 不把整段再复制成第二份 WAV。`end` 之前没有 HTTP。扩展按状态里的 `maxDurationMs` 和 `maxBytes` 停录；Companion 在 POST 前再量一次 WAV。超过保存值就拒绝为 `external_too_large` 且不发请求。等于上限则允许。

`end` 且未被取消：确认 WAV，发恰好一次 POST，然后 `voice.stt.result`。临时文件在成功、失败、取消的 `finally` 里删除。不提供「保留音频」选项。时长或体积到点造成的 `end` 与用户按下停止使用同一条发送路径。

录音中取消，或 `end` 之前的 `abort`：删除缓冲和临时文件，不调用 `fetch`。输入框不插入文字。状态文案是「已取消，没有发送音频」。

POST 开始之后取消：对同一个 `AbortSignal` 调用 abort。忽略之后到达的响应体，不插入文字。状态文案是「已停止等待。音频可能已经到达你填写的服务器。」不能承诺对方没有收到。

以下情况同样 abort 进行中的 POST、删除缓冲、不重试、不改引擎：

- WebSocket 断开。
- 侧栏关闭或会话切换触发的现有 abort。
- 用户把引擎从 external 切走。切走本身仍按第 5.4 节的校验；切走成功后，旧的 external 会话不再上传。

同一 Companion 同时只有一个语音会话。外部转写占用这个会话时，第二次 start 得到现有的 `session_busy`。不排队。

### 6.3 HTTP

只在 `end` 之后：

- `POST` 规范化后的 URL。
- 头：`Authorization: Bearer <已存密钥>`。不记录这个头。
- 体：`multipart/form-data`。
- `redirect: "error"`。
- 信号：用户取消与 `requestTimeoutMs` 的组合。截止时间从 POST 开始，包含上传和等响应，不从按下麦克风开始。
- 侧栏在发出 `end` 之后再等 `requestTimeoutMs + 10000`。到点 abort，不插入迟到文字。这个等待只用于 external。本机继续等 95 秒。

**deepseek 表单**只有 `file`。没有 `model`，没有 `language`。成功响应是 JSON，且 `text` 为字符串。依据是 2026-11-18 的 [DeepSeek Speech to Text](https://api-docs.deepseek.com/guides/asr/) 与 [API](https://api-docs.deepseek.com/api/asr/)：`POST https://api.deepseek.com/v1/tools/asr`，整文件一次返回，不支持流式；WAV 为 16-bit PCM，采样率包含 16000 Hz；单声道或立体声，立体声只识别左声道；最大 8 MiB、最长 120 秒。本设计的 WAV 是单声道，不依赖「只取左声道」。

**openai 表单**有 `file`、`model`、`language`，以及显式的 `response_format=json`。不发送 `stream`、`prompt`、`temperature`。`language` 取输入语言的 ISO-639-1 主标签：`zh-CN` 发送 `zh`。模型用已保存的 `model`，空白则在 POST 前失败，不偷偷改成 `whisper-1`。依据是 2026-11-18 的 [OpenAI Create transcription](https://platform.openai.com/docs/api-reference/audio/createTranscription)：`POST /audio/transcriptions`，`file` 与 `model` 是正文参数，`language` 可选，wav 在支持格式里，默认响应格式是 json。示例 URL 是 `https://api.openai.com/v1/audio/transcriptions`。该页同时列出流式和说话人字段；本设计不发送它们。

响应只接受 JSON 对象里的字符串 `text`。HTML、纯文本错误页、空字符串都是失败，不插入输入框。非 JSON 不当成转写结果。

### 6.4 错误

新错误码只用于 external。它们不修改 `sttEngine`，不触发 `autoFallbackToBrowser`，不启动浏览器或本机识别。

| 码 | 条件 |
|---|---|
| `external_unconfigured` | 引擎不是 external、密钥为空、openai 模型为空白，或地址不能规范化 |
| `need_privacy_ack` | 缺少 `privacy_ack_external_v1`。沿用现有码，文案写明这是外部转写授权 |
| `external_rejected` | HTTP 400，或本地 WAV 不符合本节 |
| `external_unauthorized` | HTTP 401 或 403 |
| `external_endpoint` | HTTP 404。文案提示风格和地址可能不匹配 |
| `external_too_large` | POST 前 WAV 超过已保存的 `maxBytes` 或由 `maxDurationMs` 换算的时长，或 HTTP 413。到点停录并成功发出的那一份不算这个错误 |
| `external_rate_limited` | HTTP 429。不自动重试 |
| `external_timeout` | 客户端 `requestTimeoutMs` 到点，或 HTTP 408 / 504。不自动重试 |
| `external_unavailable` | HTTP 500、502、503 |
| `external_redirect` | 3xx |
| `external_unreachable` | 主机名解析失败、没有地址、任一结果被第 5.3 节拒绝，或连接失败。此时还没有 POST |
| `external_bad_response` | 响应不是带字符串 `text` 的 JSON 对象 |
| `external_empty` | `text` 为空字符串 |
| `aborted` | 用户取消、断线、关闭或切换引擎。是否已发送音频由第 6.2 节的两句文案区分 |

现有的 `session_busy`、`payload_too_large`、`companion_disconnected` 保持原码。本机的 `infer_timeout` 不复用为外部超时。

## 7. 告知

选择「外部转写」并成功保存引擎之前，设置页展示一次确认，通过后写入 `chrome.storage.local` 的 `voice_privacy_ack_external_v1`。文案固定为：

> 停止录音后，这段聊天音频会发到你填写的转写地址。cmspark 不保留音频。密钥只保存在这台电脑的 Companion 配置文件里，权限与现有聊天密钥相同，不是系统钥匙串。

Companion 不信任扩展已经展示过文字，所以 `start` 和 `set_engine` 仍要看到该标志。设置页用一个复选框绑定 `voice_privacy_ack_external_v1`。取消勾选后，引擎若仍是 external，下一次 start 失败；已保存的地址和密钥还在，直到用户清空。取消勾选不改引擎，也不改回 browser。

设置页在密钥框下保持一行说明：保存不会连接服务器，也不能证明该地址支持转写。不放置「测试连接」按钮。

## 8. 文本纠错

现有 `asrRefinerEnabled` 继续是唯一开关，默认 `false`。

- 关闭：外部转写的文字直接进入输入框。没有第二次网络请求。
- 打开：只在 `voice.stt.result` 的 `text` 非空之后，沿用今天的 `voice.refine.request`。请求体是文字，不是音频。目标是已配置的聊天模型，不是转写地址。超时仍是现有的 45 秒文本请求上限，与外部录音时长无关。取消沿用 `voice.refine.abort`。
- 转写失败或取消：不调用纠错。
- 纠错失败：保留转写原文，并显示现有纠错错误。不重新上传音频。

设置页在外部转写一节加一句：打开「识别纠错」后，转写文字还会发给聊天模型。音频不会因此再发一次。默认不打开，避免转写之外再付一次聊天费用、再等一次。

## 9. 会议、本机与系统语音

`browser`、`local`、`system` 的采集、参数、预热、回退和错误码不改。

会议开始时若 `sttEngine === "external"`，返回 `meeting_external_unsupported`，不创建会议 PCM 会话，不调用转写 HTTP。用户可见文字：

> 会议转写仍只使用本机或系统识别。外部转写只用于聊天输入，不会发送会议音频。

这是一句拒绝，不是把会议接到外部接口上。local 与 system 的会议路径保持今天的判断（`meeting-handlers.ts` 209–212 行）。

## 10. 测试与评审

实现尚未授权。确认本设计之后的计划，按下表写失败测试，再写实现。CI 里的 HTTP 全部是假的 `fetch`。CI 不访问 DeepSeek、OpenAI 或用户填写的地址，不读取用户密钥。

| 断言 | 假实现应先失败 |
|---|---|
| deepseek 空地址、`/v1`、完整 `/v1/tools/asr` 都得到同一个 URL | 拼接出 `/v1/v1` 或接到 `/chat/completions` |
| openai 空地址得到 `https://api.openai.com/v1/audio/transcriptions`；已带该后缀的地址不变；自定义 `/openai/v1` 只追加一次 | 补第二个 `/v1` 或丢掉用户的路径前缀 |
| 用户信息、查询串、片段、公网 http、链路本地 IP 被拒绝且不写配置 | 把这些地址存进 `config.json` |
| `http://127.0.0.1:9000` 与 RFC1918 字面地址可以保存 | 本机服务被白名单拒绝 |
| 3xx 不跟随，且第二次请求没有发生 | 跟随到另一主机并再次带上 Bearer |
| 状态与 `config.updated` 不含原始密钥；`"***"` 不覆盖旧密钥；空字符串清空 | 密钥进入 `voice.model.state` 或日志 |
| `end` 之前 abort 时 `fetch` 调用次数为 0 | 取消仍上传 |
| POST 之后 abort 使信号中止，迟到的 `text` 不成为结果 | 取消后仍插入文字 |
| deepseek 表单只有 `file`；openai 表单有 `model`、`file`、`language`、`response_format=json` | 给 deepseek 发送 model，或漏掉 openai 的 model |
| 非 JSON 和空 `text` 不进入输入框 | 把 HTML 当转写 |
| 任一外部错误码之后，`sttEngine` 仍是 external，且没有浏览器识别启动 | 失败后静默回退 |
| 断线删除缓冲且不在重连后补传 | 断线后续传 |
| `asrRefinerEnabled === false` 时没有 `voice.refine.request`；为 true 时请求体只有文字 | 纠错再次上传音频，或无视开关 |
| 会议在 external 引擎下得到 `meeting_external_unsupported`，HTTP 次数为 0 | 会议音频发往转写地址 |
| external 录满 120 秒仍只有一次 `fetch`，且不在 45 秒或 2_500_000 字节处结束 | 复用 local 预算把 DeepSeek 允许的录音截断或拒绝 |
| 时长或体积到点后，已录前缀被送出一次；管道 15 秒无块则不调用 `fetch` | 到点丢录音，或把断线残段发出去 |
| openai 非官方主机的 `limitNote` 为 `unprobed-local-default`，保存不发起网络请求 | 把 25 MB 写成已探测到的对方上限 |
| deepseek 保存 120001 毫秒或 8388609 字节被拒绝 | 允许超过文档上限 |
| browser、local、system 的现有语音测试保持原断言，包括 45 秒 | 为了新引擎放宽本机超时或删除断言 |

真实密钥的手工核对不属于 CI，也不由实现代理拿用户密钥去打线上接口。用户自己确认设计并实现之后，如要抽样，只在自己的机器上录一句中文：deepseek 风格应看到文字或第 6.4 节的错误；openai 风格用一条已知提供 `/audio/transcriptions` 的地址做同样的一句。抽样不能被写成「已经比本机更准或更快」。

评审顺序：

1. 用户已于 2026-11-18 批准本修订。实施计划写在 `docs/superpowers/plans/2026-11-18-external-chat-asr.md`。该计划的独立评审通过之前，不改产品代码。
2. 计划写完后，独立评审计划与本文件是否一致，再开始测试。
3. 实现 PR 的网络和凭据差异另做一次对抗评审。评审看红线、重定向、取消和会议拒绝，不替用户宣布准确率。
4. 合并只看该实现 SHA 上现有四条 workflow、十项检查全绿。不放宽超时，不因为与语音无关的失败就重跑，不在该 PR 发版。

## 11. 自审

- 没有待定实现项。外部停录点、到点后的一次发送、管道断开不发送、请求超时和侧栏等待都已分开。
- 外部转写不使用 `autoFallbackToBrowser`，也不读取本机 45 秒、2_500_000 字节、90 秒推理或 95 秒等待。
- 空 `baseUrl` 用风格默认主机，不用聊天地址。空 `apiKey` 不能 start。二者不互相填补。
- deepseek 的 120 秒和 8 MiB 来自上述官方页。openai 官方主机只有文档中的 25 MB 文件上限，没有时长上限可引用。其它主机的出厂停止线标明未经探测。
- 临时音频删除，日志不收正文。权限边界停在 `0o600` 文件，不上升为加密或钥匙串。
- 第 12 节不进入本 PR 的任务。外部转写的实现不改 `-ng`、预热开关或本机模型目录。

## 12. 后续本地识别优化（非本 PR）

这一节只记录以后可以单独开的计划。当前不授权改本地识别代码，也不授权在用户机器上跑 benchmark。

已知代码事实，不是原因结论：本机转写调用 `whisper-cli` 时带 `-ng`，线程被压在 2 到 6（`companion/src/voice/whisper-runner.ts` 54–86 行）。`modelPrewarm` 默认关闭（`companion/src/config.ts` 第 213 行）。所谓流式是隔一段时间把已有音频再解一遍（`session-caps.ts` 18–20 行）。这些事实不能说明用户这台机器慢或准的原因。

以后的计划按这个顺序，前一步没有同批录音的测量，就不做下一步：

1. 先定基线：同一批真实中文录音，记下准确率，以及模型加载、推理、端到端分段耗时。
2. 再看 Mac 硬件加速是否可行，包括现在强制 CPU 的 `-ng` 能不能在测量后改为可选。
3. 再动模型档和语言参数。
4. 再动冷启动、暖启动和预热。
5. 最后才动周期性整段重解。

验收必须用同一批录音比较准确率和上述耗时。只变快、准确率变差，不算通过。没有这批测量，计划里不得写「用户机器慢」或「已经比现在更准」。
