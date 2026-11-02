# #825 B：聊天范围后端独立交叉验证

2026-11-02；工作区 `$REPO`。

结论：指定 B 差量未发现有支持路径、影响本轮验收的缺陷。真实源码的冻结同图、标题门、内容裁剪、只读预览及最终 Service/model/store 数据流通过独立动态验证。此结论只覆盖 B 后端；Windows 原生窗口、截图及 OCR 成败由 Windows native CI 验证。

## 能力与评审范围

- Surface：Windows 指定 app 的主动校准、标题预检、按窗口 class/尺寸匹配的范围采集。
- L2 / Autonomy：沿用被动采集安全资格，未新增自动切换、恢复、点击或滚动。校准由用户主动点击。
- Compose：一次窗口截图 → 同图本机标题 OCR → 完整允许标题精确匹配 → 内容区域裁剪 → OCR 或所选图像模型 → 来源/候选。未校准、布局变化、标题不匹配时不生成来源或模型请求。
- Trust / Channel：窗口、图片、OCR 标题均不可信；本机标题 OCR 只作范围门；只有裁剪内容可进入来源与模型端口。整窗校准预览不进入来源库或模型。

只读检查了实际 git diff 与新增 `chat-scope.ts`，以及 `platform.ts`、`service.ts`、`store.ts`、`validation.ts`、`types.ts`、`image.ts`、现有 `computer-capture.ps1` crop-only 分支、Windows native 测试及 CI 接线。没有修改 B 或其他产品实现。

## 独立执行证据

```sh
source ~/.nvm/nvm.sh && nvm use 22.23.4 >/dev/null && node /tmp/cmspark-825-scope-cross-probe.cjs
```

exit 0；完整日志 `/tmp/cmspark-825-scope-cross-probe.log`。

probe 直接编译/执行当前 `WindowsPassiveRecorder`、`ActivityService`、`ActivityStore`、范围/消息验证、模型目标和 PNG 解码源码。配置为隔离的空配置，不读取用户凭据；模型为观察端口，操作系统 PowerShell 为受控本机边界。它独立生成一张 100×80 已知逐像素图像，侧栏为不同颜色，内容包含独立的图像色块；使用真实 PNG producer/decoder。没有复制 crop、scope、Service 的产品决策逻辑。

实际输出：

```text
READONLY_REAL_SERVICE_PREVIEW_OCR_PASS
FROZEN_FRAME_TITLE_AND_CONTENT_EXACT_PIXELS_PASS
MISMATCH_SKIPS_CONTENT_STORE_MODEL_PASS
OCR_BODY_SEES_ONLY_EXACT_CONTENT_PIXELS_PASS
SCOPE_CROSS_PROBE_PASS
```

### 已观察的结果

1. 通过真实 handler 请求 preview，再把其整窗 PNG 原字节交 preview_ocr。预览字节 SHA256 等于生成整窗；标题 OCR 只收到 `{x:35,y:4,width:50,height:10}` 的精确像素。两次调用后 revision 不变、sources=0、model calls=0，所有 pending 文件清理。
2. 一次真实 scan 恰好发出 1 次原始截图、2 次 CropOf。标题 crop 与内容 crop 读取的原图 SHA256 均等于那一次截图；没有第二次窗口截图。内容框为 `{x:30,y:0,width:70,height:80}`。
3. 图像模型收到的每个 RGBA 像素都等于预期内容矩形；库中最终 PNG 解码像素与同一预期矩形完全一致，含内容图像色块、无侧栏像素。它不是仅凭尺寸或几个颜色点推断成功。
4. 把 OCR 标题由 ALPHA GROUP 改为 BETA GROUP 后，真实 Service 返回正常 scope_title_mismatch 状态；本轮只发生标题 crop，无内容 crop、无新增来源、无模型请求。
5. 改为 OCR 提取模式后，正文 OCR 同样只收到内容裁剪图的逐像素结果；没有将原始整窗交正文 OCR。

## 真实路径核对

- `companion/src/activity/platform.ts:65` 起保留原 Probe → allowlist → 普通桌面/完整性级别 → Passive capture → after Probe 身份核对路径，并把 window_class 纳入前后对比。
- `platform.ts:79`–`:92` 从冻结 file 读图；`ocrTitle(image, ...)` 对同一图标题 crop，精确 allowlist 通过后才 `crop(file, profile.content, ...)`。OCR 模式使用已裁剪 image；图像模式返回已裁剪 image。
- `platform.ts:49`–`:55` 使用现有 computer-capture.ps1 的 CropOf 路径并检查最终尺寸，不把 native 边缘 clamp 当作有效完整矩形。
- `companion/src/host-use/win/scripts/computer-capture.ps1:166` 的 crop-only 分支从文件按像素读取并在窗口截图分支之前 exit；没有窗口交互。
- `companion/src/activity/chat-scope.ts:44`–`:50` 区分未限定 app、显式空 profile、恰好一个 class/尺寸匹配；缺 profile 不回退整窗。`:53` 起 preview 与 live title 使用同一 OCR 投影，不做 substring 扩权。
- `companion/src/activity/service.ts:109`–`:141` 校准与 scan 共用 pending 串行，检查 generation/abort/requestCurrent。preview 仅将传入 app 作为临时 allowlist 并绕过旧 ROI，以支持重新校准；仍调用原 recorder 安全路径。无 addSource 或 extract 调用。
- `service.ts:156`–`:169` 只把 recorder 返回的裁剪图写来源和模型链；范围拒绝为正常可见状态；`store.ts:89` 把 conversation_title 纳入证据去重。
- schema 对矩形、标题包含关系、class/尺寸、重复布局、app 范围和 preview_ocr 消息有实际闭集验证。

## Windows 原生验收

本机运行在 macOS，以上是实际 TypeScript 路径加受控 PowerShell 边界的动态证明，没有把它宣称为 Windows 原生通过。已读 `companion/tests/activity-scope825-native.test.ts`：使用 owned WPF 两栏窗口与独立聊天窗口，实测本机 OCR、侧栏诱饵拒绝、图像内容保留、布局变化拒绝、只读预览、前台 HWND 不变和 pending 清理；遵守现有 Surface650 lease。

CI `.github/workflows/ci.yml:315` 已在 Windows native lane 的既有步骤执行该测试。最终需看到下列 Windows 命令绿：

```sh
cd companion
CMSPARK_ACTIVITY_NATIVE_758=1 node scripts/run-tests.mjs .test-dist/tests/activity-platform-native-758.test.js .test-dist/tests/activity-apps-825.test.js .test-dist/tests/activity-scope825-native.test.js
```

本轮不重复已由实现者提供的全部后端 suite，也没有扩展到范围外模型质量或新队列设计。

VERDICT: APPROVE
