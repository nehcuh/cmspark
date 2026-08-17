# 对话框用户附图 — 产品设计（锁定）

**Date**: 2026-08-17  
**Status**: Locked for dual-review (Claude + Pi). Do not implement until dual APPROVE*.  
**Blast**: T2  
**Strawman**: `docs/decisions/clipboard-image-paste-strawman-2026-08-17.md`  
**Adversary synthesis**: `docs/audit/reviews/clipboard-image-paste-adversary-synthesis-20260817.md`  
**Related**: vision-reuse P0 · ADR-020 · `file.upload` · `vision-pipeline.ts`

This document is the product SoT. Where it conflicts with the strawman, **this file wins**.

---

## 0. Capability declaration (ADR-020)

```text
Surface:      L0 (chat composer attachments — no new CDP/tool)
L2-classes:   (none)
Compose:      none (not a Pack / skill / MCP; reuses file.upload + vision rail)
Autonomy:     single
Trust:        user-initiated image bytes go to the effective chat LLM endpoint
              (native) or config.vision (text-only fallback).
              No new confirm dialect. Destination hostname on chip + first-send line.
Channel:      community
```

**Forbidden language**: 中层 Agent · 第二 runtime · 新确认方言 · 「主对话永远不收图」.

**Not this feature**: tool `screenshot` · page `analyze_image` · PDF 内嵌图 · Qwen3-VL 定位 · `clipboardRead`.

---

## 1. Thesis

> 用户可以把系统截图、网页「复制图片」、或文件管理器里的图片，粘贴 / 点选 / 拖进 Side Panel 输入区。  
> **线程生效主模型**若 `likelyMultimodal`，这些**用户附图**作为本轮 user message 的图像块发给主模型（OpenAI `image_url` / Anthropic `image`）。  
> 主模型是纯文本（或未知 — fail-closed）时，走现有 `analyzeImage` 视觉轨。  
> 工具截图 / `analyze_image` / 文档内嵌图 **仍走视觉轨**，这次不改。

用户对话已锁定、对抗后仍保留：

| ID | Lock |
|----|------|
| U1 | 三种剪贴板来源都接 |
| U2 | 空框：挂附件等发送。框里已有字：同拍挂上并发送 |
| U3 | 粘贴 + 附件按钮 + 拖到输入区 |
| U4 | 主模型能看图 → 原生；否则视觉轨。不因 API 400 静默降级 |

---

## 2. JTBD / 非目标

| 角色 | 痛 | 做成什么样算成 |
|------|----|----------------|
| GPT-4o / Kimi VL / glm-4v / Claude Messages | 粘贴没反应；或被弱 VLM 先转述 | 主模型直接看见刚截的屏；历史里看得到小图 |
| DeepSeek / llama3.1 | 主模型不能看图 | 同一套粘贴；开了视觉就转文字；没开则**发不出去**并说清楚 |
| 本地廉价 VLM + 强文本主模型 | 怕被「主模型复用」吃掉分流 | 文本主模型仍走 `config.vision` |
| 只点过「使用主模型」的截图用户 | 设置复用 ≠ 对话原生看图 | 截图仍先转文字；**粘贴**才是原生轨 |

**非目标（v1）**

- HEIC 转码  
- 工具截图 / PDF 内嵌图改走原生  
- 原生失败自动降级视觉  
- 申请 `clipboardRead`  
- 拖入网页 URL 去拉图  
- 对话里点开全尺寸灯箱  
- 新 L2 / 新确认家族  
- 提高 `MAX_WS_MESSAGE_SIZE`  
- 新增 `supports_vision` 配置项  

---

## 3. 用户可见行为

### 3.1 输入

- **粘贴**：textarea 与 InputArea 根节点 `onPaste`。`clipboardData.items` / `.files` 中 `kind=file` 且体积 > 0 的 allowlist 栅格图 → `preventDefault`，加入附件。**不**把同行的 `text/html` / URL 贴进框。已键入的字保留。
- **拖放**：InputArea `dragover` 高亮，`drop` 收 `DataTransfer.files`（图 + 现有文档类型）。拒绝：`text/uri-list`、`text/x-moz-url`、`text/html`、纯 URL 的 `text/plain`、0 字节 File、`data:` / `blob:` / `file:` URI。**禁止** `fetch` / `fetchImageAsBase64` / `analyze_image`。
- **附件按钮**：`accept` 增加 `.png,.jpg,.jpeg,.gif,.webp` 与对应 MIME。`title` 改为「添加文件或图片」。
- **忽略粘贴/拖入**（不消费剪贴板）：无线程 / 未连接 / `threadBusy` / `l2_task` / `voice.liveOverlay != null` / `voice.listening`。
- Worker / 编排线程：同一套限额与分流，不加新 chrome。`run_busy` 仍可发送（现状）。
- 空状态（chat/browser）：加一行「可直接粘贴截图」。computer 空状态仍走 cockpit。

### 3.2 附件条

- 图：48px 缩略图（React `<img src={blob:}>`，仅已 sniff 的栅格字节；卸载 `revokeObjectURL`）。文档：现有文字 chip。
- 剪贴板无名文件：显示名 **`截图 YYYY-MM-DD HH:mm`**，不用 `image.png`。
- 经过压缩：chip 上 `已压缩`。
- chip 副文案始终带目的地主机：`→ api.openai.com` 或 `→ vision.example`（按即将走的轨）。
- × 移除。第 5 张图 / 超限 / 拒收格式 → 输入区 `fileError` 横幅，**不发送**。
- 混合粘贴（一张 HEIC + 一张 PNG）：收下 PNG，横幅拒 HEIC，**不**丢掉已键入的字。

### 3.3 发送

| 输入区状态 | 行为 |
|------------|------|
| 只有图，无字 | 默认文案：一张 `请看这张图`；多张 `请看这些图片` |
| 只有文档，无字 | 保持 `请分析我上传的文件` |
| 图+文档，无字 | `请查看附件` |
| 有字 | 用用户的字 |
| 有字 + 粘贴/拖入图 | 同拍加入附件并发送（把**新列表**传进 `handleSend`，禁止 `setState` 后再读旧 state） |

**Composer 预检（先于 WS）**

1. 线程生效模型 `!likelyMultimodal` **且** 视觉轨关（`!(vision.enabled && file_upload.enable_vision_analysis !== false)`）→ **不发送**，横幅：「当前主模型不能看图。请在设置中开启视觉分析，或换一个多模态模型。」芯片保留。
2. 压缩后单张 > 4MiB 或图合计 > 6MiB 或整帧 JSON > 10MiB−256KiB → 不发送，横幅，芯片保留。
3. Companion / SW 拒绝：芯片**回到** `selectedFiles`，不留幽灵用户气泡。成功或 `file.upload_error` / 断线前不要清空芯片。

听写结束后框里有字再贴图 = 会发出去（U2）。可接受，因为历史里有缩略图 + 目的地。

### 3.4 对话气泡

- 用户气泡：文案 + **48px 缩略图**（与输入区同级，不是灯箱）。
- 乐观更新用内存 blob；重载后用消息上的 **≤8KB / 96px JPEG preview**（`attachments[].preview_jpeg_b64`）。原图只在 sidecar。
- 副行：`📎 截图 2026-08-17 15:58 · → hostname`。
- 模型已换成纯文本：缩略图**仍显示**（本地 preview），不再把原图像素 POST 给新模型。
- 全尺寸查看：v1 不做。

### 3.5 编辑 / 重新生成 / 分叉

- 编辑只改说明文字；缩略图留下。v1 不提供编辑态 × 丢图（避免误删 sidecar）。
- `chat.regenerate` / `skipUserMessage`：hydrate 仍带图（见 §5）。
- Fork：把 sidecar **拷贝**到新线程新文件名，重写 `attachments`。禁止继承父线程 `rel`。

### 3.6 目的地第一次说明

- 每个 **destination hostname** 第一次走原生发图：输入区一行（非 modal、非 L2）「图片将发送至 {hostname}」。
- `chrome.storage.local` 的 ack **按 hostname 本身**记（含 `thread.config_override.base_url` 解析出的主机，不是只看全局 `llm.base_url`）。键：`cmspark.imageDestAck.<hostname>`，值为 ISO 时间。主机变了再提示。
- 失败文案也带 hostname。

### 3.7 压缩

发送前在扩展里：

1. 已 ≤ 4MiB 且长边 ≤ 1568 → 原样（保留 PNG/GIF 透明度/动画）。
2. 否则画到 canvas，长边 **≤ 1568**，导出 JPEG q≈0.85（GIF 动画保原样，若仍超限则拒并说明「动画图请先缩小」）。
3. 芯片标 `已压缩`。典型 Retina 全屏截图必须能发出去。

1568 使 OpenAI high-detail tile 估算 ≈ 1600 tok/图，与预算一致。

---

## 4. 分流（Companion SoT）

```
effective = { ...config.llm, ...thread.config_override }
useNative = likelyMultimodal(effective.model_name)   // 不看 protocol
```

`likelyMultimodal` **只以** `companion/src/llm/likely-multimodal.ts` 为准。扩展 / settings-web 可镜像，同一组测试向量。客户端不能强迫原生。

分流函数签名：`likelyMultimodal(modelName)`，**不读 protocol**。Claude 家族靠**名字**判 true（`claude|sonnet|opus|haiku`），因此 Anthropic Messages 主模型会走原生——这是故意的。`shouldOfferVisionReuse` 仍对 `protocol=anthropic` 硬拦（视觉轨不会 OpenAI image_url）。两套函数不要合成一个。

相对 P0 启发式的修正（必须进 SoT 测试）：

- **剔除** `kimi-k2`、`moonshot-v1*`（无 `vl|vision|omni`）— 它们是文本模型，P0 测试里被误标 true。同步改 `chrome-extension/tests/vision-reuse-logic.test.ts`（现断言这两名为 true）。
- `kimi` + `vl|vision|k1.5` 等仍 true。
- 未知 → false。

| 情况 | 用户附图 | 文档 / PDF 内嵌图 |
|------|----------|-------------------|
| `useNative` | 本轮 image parts；**不**调 `analyzeImage` | 现有 `<document>`；内嵌图仍视觉轨 |
| `!useNative` 且视觉轨开（`vision.enabled && file_upload.enable_vision_analysis !== false`） | `analyzeImage` → 文字写入磁盘 `content`（见 §5.1a） | 不变 |
| `!useNative` 且视觉轨关 | 预检拦截；若漏网则 `file.upload_error` | — |

原生被端点 400：把 provider 错误亮给用户（带 hostname）。**不**静默改走视觉。芯片恢复。

---

## 5. 协议与历史

### 5.1 仍用 `file.upload`，但 `chatCreate` 增加字段

```ts
fileContents?: Array<{ filename: string; content: string }>  // 解析后的文档 ONLY

imageAttachments?: Array<{
  name: string
  mime: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  sha256: string
  bytes: number
}>
```

禁止把 PNG base64 塞进 `fileContents`（会变成 `<document>` 垃圾）。

Router：

1. 解码 → sniff → `sniffed === normalizeImageMime(type)`，否则拒。
2. **先**按 MIME 分流，**再**走文档 `allowed_types` / `parseFile`。图永不进这两处。
3. 文档走现有 parse +（可选）内嵌视觉。
4. Companion **重核** 4 张 / 单张 4MiB / 合计 6MiB / 整帧 JSON。漏网客户端不得打到 `maxPayload`。
5. 通过 LLM 门（paused / trashed / 并发 cap）之后才写 sidecar；门拒则不落盘。**不要**在 router 里 `addMessage` 用户轮。
6. 把 metadata 交给 `chatCreate.imageAttachments`（sidecar 已在步骤 5 落盘）。

`chatCreate` **恰好一次** `addMessage`：

```
content:  用户文案 + "\n📎 " + 显示名列表
          [视觉轨时追加 §5.1a 描述]
attachments: [{ kind:"image", name, mime, sha256, bytes, preview_jpeg_b64 }]
```

磁盘 `content` 永远是 string。像素不进 `threads/<id>.json`。Sidecar + preview 两种轨都写（换模型后 UI 仍能显示缩略图；`!useNative` 时 hydrate **不** POST 像素）。

### 5.1a 视觉轨描述的载体（Claude dual-review 阻断项 · 已锁）

`!useNative` 且视觉轨开：`analyzeImage` 的说明必须进**磁盘 `content`**，否则 regenerate / `skipUserMessage` 只会重放 `📎 名字`，主模型第二次看不见图。

格式（对齐今天 PDF 内嵌图，`message-router.ts` 现有 `<!-- 文档内嵌图片分析 -->`）：

```
{用户文案}
📎 {显示名}

<!-- 用户附图分析 -->
[图片: {显示名}] {description}
```

禁止另造 `vision_text` 字段当唯一载体（regen 只重放 `content`）。`fileContents` 仍只装文档。原生轨不加这段（模型看的是 parts）。

发成功后回 `chat.user`（或等价）带 **磁盘 `message_id`**，乐观气泡改用这个 id。否则 regenerate / 单条导出对不上（文档上传已有此坑，附图后变成主路径）。

### 5.2 Hydrate 是唯一注图点

```
rebuildMessagesFromHistory(history)          // 纯配对，仍是 string
→ hydrateUserImageParts(rebuilt, persisted, { useNative, maxImages: 4 })
→ runContextBudgetPass("pre_loop")
→ provider.streamChat
```

- `rebuildMessagesFromHistory` **禁止**读盘、禁止 `likelyMultimodal`。
- `skipUserMessage`（regenerate）走同一段 hydrate。
- 同一次请求的 tool loop **不再** hydrate（内存里已有 parts）。
- `!useNative`：剥掉 parts，留文字 stub；sidecar 不删。以后换回多模态可再 hydrate。
- 窗口内最多 4 张图（新的优先）；更早的变 `[图片: name]`。
- sidecar 丢了：`[图片丢失: name]`。

### 5.3 Provider

- OpenAI：parts 原样（`image_url` data URL）。v1 **不**设 `detail:"low"`（压缩后 1568 已够；low 会看不清报错字）。
- Anthropic：`AnthropicContentBlock` 增加 `image` + `source.base64`。连续 user（omit notice + 真 user）**按 block 拼接**，禁止 `String(parts[])`。合并本身保留（Anthropic 拒连续 user）。
- `complete()` / 标题 / 摘要 / H1 / Obsidian：**永不**收图。

### 5.4 Context budget

- `serializeMessage`：text 按现规则；每个 **仍在 parts 里的** image：
  - 长宽比 > 1.3（典型截图）→ **+1600**
  - 压缩后短边 ≥ 1200 的近方形 → **+2800**
  - **其余默认 +1600**（例如 1300×1000：既非宽屏也未达短边门槛）
  - 视觉轨无 parts，描述按纯文本估
  - Anthropic 原生先用同一张表。1568² 按 Anthropic `(w·h)/750` ≈ 3.3k，比 2800 高；v1 接受这点低估，靠 4 张帽 + compaction 兜住。实现时为 1568×1568 钉一条 token 测试向量，不必为 r2 再改表。
- `redactMessagesForCompaction`：parts 拍扁成 stub，禁止对 array `.replace`。
- 标题预览只切 string stub。

### 5.5 Sidecar

路径：`~/.cmspark-agent/threads/<safeId>.files/<safeMsgId>-<n>.<ext>`  
`ext ∈ {png,jpg,gif,webp}`，由 sniff 决定，不由用户文件名决定。

- 目录 `0o700`，文件 `0o600`。`mkdir` 后 `lstat` 必须是非 symlink 目录。
- 加载：只信 companion 自己写下的 basename；`realpath` 必须严格落在 `realpath(threads/<id>.files)` 内。
- **禁止**把客户端 `rel` / `sha256` / `name` 当路径。
- 硬删（`delete` / `batch_delete` hard / `purgeExpiredTrash` / `cleanupEmpty`）：按同样 realpath/lstat 删 `.files/`。目标是 symlink → **拒绝**，不要 `rmSync`。ENOENT 可忽略。
- 软删：保留 sidecar。
- 消息条数封顶丢掉旧 JSON 行时：同步删对应 sidecar。
- `deleteMessagesFrom`（regenerate 裁掉后面的轮）：删那些行对应的 sidecar，避免孤儿文件。
- `preview_jpeg_b64`：**仅 Companion** 在 `addMessage` 时从 sidecar 生成（≤8KB / 96px JPEG），写入 metadata。扩展乐观态用内存 blob；回传 `message_id` 后改用 preview。禁止把全图 base64 塞进 JSON。

### 5.6 线框预算

| 项 | 值 |
|----|----|
| MIME | png / jpeg / gif / webp（与 `ALLOWED_IMAGE_MIMES_LIST` 锁步，**不含** svg/bmp/tiff） |
| sniff | 见 §6 |
| 压缩后单张 | ≤ 4 MiB decoded |
| 压缩后图合计 | ≤ 6 MiB decoded |
| 整帧 `file.upload` JSON | ≤ 10 MiB − 256 KiB（扩展 **和** companion 都算） |
| 每发图数 | ≤ 4 |
| `files.length` | 图+文档合计仍 ≤ 10（现校验） |
| `MAX_WS_MESSAGE_SIZE` | **不改** |

文档体积规则不变，但必须和图像、信封挤在同一帧里。超了在客户端拒，不要撞 `maxPayload` 1009（会杀掉整条控制面）。

扩展 SW 已在算 `json_bytes` / `over_companion_10mb` 却仍发送 — **改为拒发**并回 `file.upload_error`。

---

## 6. Magic sniff（必须实现，不是注释）

Companion 在 `Buffer.from(content, "base64")` 之后；扩展发送前可预检同一套字节。

```
PNG  89 50 4E 47 0D 0A 1A 0A
JPEG FF D8 FF
GIF  47 49 46 38 37/39 61
WEBP 52 49 46 46 .... 57 45 42 50   // 拒 RIFF/WAVE
```

1. `sniffed = sniffRasterImage(buf)`，`null` → 拒（内容与类型不符）。  
2. `declared = normalizeImageMime(type)`，`null` → 拒（HEIC/SVG/BMP/…）。  
3. `sniffed !== declared` → 拒，**不要**改类型放行。  
4. 某些 OS 粘贴 `File.type` 为空：扩展必须先 sniff 再填 type；空 type 现校验已拒。

前缀 sniff 杀不掉 GIFAR / JPEG+HTML。可接受条件：缩略图只用 `<img>`，文件永不执行。

**禁止**把 `file-parser.ts` 的 `IMAGE_FORMATS`（含 svg/bmp/tiff）用于输入区准入。

---

## 7. 错误文案（中文）

| 情况 | 文案 |
|------|------|
| 不支持的格式 / HEIC / SVG | 不支持该图片格式（请使用 PNG / JPEG / GIF / WebP） |
| 压缩后仍超限 | 图片过大（压缩后单张 ≤4MB，合计 ≤6MB） |
| 整帧超 10MB | 附件总体积过大，请少选几个文件 |
| 网页链接拖入 | 不能从网页链接拉图；请复制图片本身或改用截图 |
| 文本主模型且视觉关 | 当前主模型不能看图。请在设置中开启「视觉分析」并配置视觉模型 |
| 原生端点拒图 | 主模型拒绝了图片（{短错误}）。可换多模态模型，或改用文本模型并开启视觉分析 |
| sniff 不符 | 文件内容与类型不符，已拒绝 |
| sidecar 丢失 | [图片丢失: name] |
| 第 5 张 | 一次最多添加 4 张图片 |

预检/拒收走输入区横幅。不要先乐观插入用户气泡再在下面加 ❌（Companion `uploadError` 若在用户 `addMessage` 之前失败，也不要落盘用户轮）。

---

## 8. 设置文案（Side Panel + settings-web 同一补丁）

必须改掉的谎言：

| 现文案 | 锁定替换 |
|--------|----------|
| `VISION_COPY.sectionHelp`「（主对话不会直接收图）」 | 本段只管**工具截图 / analyze_image**：先视觉轨转文字再进对话。输入框**粘贴/选/拖的图**另算——主模型能看图则直送主模型，否则才走本视觉轨。 |
| settings-web `main loop does not receive image bytes` | 与上对齐的英文，区分 screenshot rail vs user attach |
| `fallbackPassthrough`「主模型通常仍不能真正看图」 | 仅描述**视觉轨失败**：视觉轨会把截断 base64 塞进说明；只有主模型走原生看图时才能看见像素 |
| 文件上传「上传图片时尝试使用视觉模型…」 | 仅当主模型**不能**看图时，用户附图才走视觉轨。主模型能看图时此开关不影响粘贴/选/拖 |
| `正在解析文档` / `文档已解析`（对 PNG） | `正在处理图片…` / `主模型看图中…` 或 `正在分析图片…`（视觉轨） |
| 附件按钮「上传文件」 | 添加文件或图片 |
| `file_upload_max_size` 滑条 | 注明**不**提高 4/6MiB 图像预算 |

「使用主模型」横幅/芯片 **只**服务截图视觉轨，不要拿来解释粘贴原生。

占位符（chat/browser）：`问任何问题，或粘贴截图…`。

---

## 9. 安全 / Trust

- 不申请 `clipboardRead`。不要用 `navigator.clipboard.read()`。
- 不新开 `SecurityConfirmationManager` family。目的地用 chip + 首次一行（P5）。
- `shouldBlockVisionRequest` 仍管视觉轨。原生用主模型 key（和普通聊天同一信任级）。
- `jailbreakScanWindow` **不**覆盖像素。系统提示把用户附图标成不可信数据（`<untrusted-image name>`），不加 L2。
- 日志：只记 `byte_len` / sha256 / sniffed MIME。`redactLogData` 增加 `content` / `base64` / `image_url`。
- `file.upload` 保持 HMAC。建议拒 tray origin（纵深；文档上传已是 paired peer）。
- Worker LLM **不能**发 `file.upload`（保持）。用户往 worker 线程贴图：同一限额。

---

## 10. 文件级切分（实现时按此，本批不写代码）

1. `companion/src/llm/likely-multimodal.ts` + 锁步测试（含 kimi-k2 剔除）；同步改 `chrome-extension/tests/vision-reuse-logic.test.ts` 里对 `kimi-k2` / `moonshot-v1-128k` 的旧断言  
2. `companion/src/llm/image-sniff.ts` — sniff + normalize  
3. `companion/src/llm/image-parts.ts` — hydrate、4 张帽、stub、token  
4. `companion/src/llm/adapter.ts` — `imageAttachments`；一次 addMessage；rebuild 后 hydrate  
5. `companion/src/llm/providers/anthropic-convert.ts` + `openai.ts` — image block + block merge  
6. `companion/src/llm/context-budget.ts` — serialize / estimate / redact 认 parts  
7. `companion/src/message-router.ts` `file.upload` — MIME 先分流  
8. `companion/src/threads/thread-manager.ts` — `attachments`、sidecar CRUD、硬删/fork  
9. `chrome-extension/src/sidepanel/App.tsx` — paste/drop/picker、同拍发送、压缩、预检、回收 id  
10. `ChatView.tsx` — 气泡 48px preview  
11. `vision-reuse-logic.ts` + `settings-web.ts` — §8 文案  
12. `chrome-extension/src/background/index.ts` — 整帧 JSON 超限拒发  

不要先做 9/10 再做 3/4/5：没有 hydrate 的 UI 只是「第一轮能看、regen 变瞎」。

---

## 11. 外部可观察 DoD（实现后机核）

1. 粘贴 / 拖 / 选 allowlist 图成功；HEIC/SVG/URL 拖入被拒且有文案  
2. 空框贴图不自动发；有字贴图一次发出，无 stale `selectedFiles`  
3. `likelyMultimodal` true → standalone 图 **零** `analyzeImage` 调用（spy）  
4. `likelyMultimodal` false + vision 关 → 预检不发；漏网则 `file.upload_error`  
5. sniff 不符 / HEIC 拒  
6. Anthropic 转换产出 image block；连续 user 合并后图还在  
7. 当前模型改文本后 hydrate **剥** parts；preview 仍在 UI  
8. sidecar 0o600；硬删去掉 `.files/`；fork 拷贝新文件  
9. 整帧 >10MiB−256KiB 客户端拒发，companion `maxPayload` 不被合法发送打到  
10. manifest 无 `clipboardRead`  
11. 设置不再把「主对话不收图」写成全称；settings-web 同步  
12. 工具截图 / `analyze_image` 单测无回归  
13. 乐观气泡在成功后改用磁盘 `message_id`；对该条 regenerate 仍带图  
14. 典型大截图（压缩前 >4MiB）经压缩后发出，芯片有 `已压缩`  
15. `kimi-k2` / `moonshot-v1-128k` 的 `likelyMultimodal` 为 **false**  
16. 视觉轨发图后磁盘 `content` 含 `<!-- 用户附图分析 -->`；对该条 regenerate 仍带描述、不 POST image parts  

---

## 12. Eval gate card

**Blast tier**: T2  
**Capability**: §0  

### Machine（实现阶段才跑）

- companion：sniff / hydrate / anthropic merge / likelyMultimodal / sidecar containment  
- extension：compress 纯函数、paste 分类、整帧 JSON 计算  
- 相关 suite 绿  

### Judges（本批 = 设计）

- 独立对抗：三路 REJECT strawman → 本锁定表吸收 → `clipboard-image-paste-adversary-synthesis-20260817.md`  
- 下一步：`scripts/dual-external-review.sh` Claude+Pi 审**本设计**（无实现代码）  

### Blast

T2：一级输入 UX + adapter 形状，无新 tool/L2。图像出站与今天截图视觉轨同类，且用户手势触发。T4 不成立（非 default-on 对外声称）。

---

## 13. 实现次序（dual APPROVE* 之后）

1. Companion SoT：heuristic + sniff + hydrate + anthropic merge + tests  
2. `file.upload` 分流 + sidecar + 一次 addMessage + message_id 回传  
3. 扩展：压缩、paste/drop/picker、预检、整帧拒发  
4. ChatView 缩略图 + 文案  
5. 设置诚实文案  
6. 机核 DoD → 实现后再跑一轮独立对抗 → Pi  

---

*Locked design · 2026-08-17 · implementer must not self-APPROVE*
