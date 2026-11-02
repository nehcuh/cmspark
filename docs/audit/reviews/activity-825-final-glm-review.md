# #825 最终 GLM-Claude 源码门回执

- 目的：允许提交冻结候选进入最终 hosted CI；**不表示 Windows 原生、最终 CI、Release 或本地换装已通过**。
- Reviewer：Claude Code 2.1.153，端点主机 `open.bigmodel.cn`，实际 modelUsage 仅 `glm-5.3`；process exit=0，is_error=false。
- Base：`ea7322800a2b65abd68134f1a0f7d853dc8ac5d5`；冻结 staged 路径：59。
- Source diff SHA256（完整候选，含资产/既有审计的绑定摘要）：`564a3c6b1a1e22586177cb2e3177bc192ebbcacb025d4a667b97a2d36946f154`。
- Product/test/CI/user-doc text diff SHA256：`351564405889ef727d65855ea5785fa4170dc4d2850025810bb716ea7238719f`。
- Prompt SHA256：`8bbe5be015beb752f023c0ee9bc8c625abec9078432a2a9ff1ad0bb2c06b1b05`；530637 bytes。JPG二进制和重复审计diff不送文本，完整实际报告/关键调用链另附于输入。
- 请求起始 UTC：`2026-11-02T16:31:44.921869+00:00`；模型耗时 254869 ms。回执形成前 source index 与冻结摘要一致。
- 所有 fixture 元数据在 API 调用前确认来自隔离合成配置。未提交 live 配置、私人缓存、原始宿主全量日志或未暂存本机元数据给复审器。
- 非阻断 lease 观察已核真实源码：`retain()` 置布尔 `retained=true`，`settled()` 清布尔，重复 retain 不会叠加计数。其余非阻断观察不作为放宽原验收时限或权限的依据。

以下为实际 GLM-Claude 完整复审正文（未经改写）：

---

# #825 最终源码复审（提交 hosted CI 前）

## 总体结论

59 个 staged 路径逐一核对完毕。A（进程发现/3 秒间隔）、B（指定聊天范围）、C（草稿保留/鉴权绑定）三块实现与已批准设计及 GLM 复审的“必须保留实施检查”逐条对应，五处 RPC 接线一次到位，服务端结构校验完整，拒绝始终 fail-closed。未发现有“可达触发→支持路径→本轮验收实际影响”的 blocker。机器事实表述与证据范围诚实（Mac 全 suite 未绿、Windows native 待 hosted CI 均如实标注）。允许提交进入最终 hosted CI；不构成发版批准。

## 关键模块核对

1. **Apps/Probe 资格分离与 4096 全链**：`activity-windows.ps1` Apps 分支先收集窗口状态观测（EnumWindows+IsIconic+DWM cloaked），再独立遍历 `Get-Process`，窗口不决定入选；`Process-Identity` 同会话+可解析路径+敏感正则+SHA256，与 Probe 共用；Apps 不加载 UIAutomationClient、不取前台、无标题。`decodeWindowsActivityApps`（windows-apps.ts）严格闭集键、win.* 身份、同名合并取最高状态、确定性排序，>4096 抛 `APP_LIST_LIMIT_EXCEEDED`；wire matcher 同步放宽到 4096 并接受 `window_state`；前端搜索先过滤后分页、已选经 `knownAppNames` 保留。producer(4096/4097 拒)/decoder/wire/测试/spec 一致，明确拒绝而非静默截断，未为早期草案加缓存。✅
2. **同帧标题 gate 与 content-only crop**：`platform.ts` capture 读一次冻结文件，`profileForFrame` 按 class+IHDR 宽高唯一匹配，空 profile/布局变化均 `ActivityScopeSkip`，无整窗回退；`ocrTitle` 与 `crop` 均走 `withPendingImage` 嵌套 finally，crop 后核对输出尺寸防原生 clamp；标题 exact 比对（`recognizedChatTitle` 预检与 gate 共用同一投影，非整图 `join('\n')`）；不匹配/读不到在内容裁剪前抛出，无 source/AI 调用（scope825 测试断言 CropOf 次数与 pending 目录为空）。UI 语言变化/取消/晚到回执经 version+abort 隔离。✅
3. **两个 RPC 接线**：background `index.ts` 白名单→`forwardWorkspaceRequest`（自有 extension origin、sidepanel/workspace 路径）、`ws/validate.ts` validators、`validation.ts` extras+矩形/语言/base64 校验、`message-router.ts` dispatch、service `preview/previewOcr`、前端专用 matcher+90s/45s，六处齐全。preview 由 server 构造 `{allowed_apps:[appId], chat_scopes:[], extraction_mode:'vision'}`，仅绕旧 ROI，仍走原 Probe/安全/被动/前后身份链（含 window_class），无 addSource/extract；与 scan 共用 `pending` 单飞，generation/requestCurrent fence 生效。✅
4. **fresh state→第三参→原子 revision**：编辑器 baseline 指纹 `[config, model_target_ids]`，提交恰好一次 `activity.state` 新鲜读取，比对后以 `fresh.revision` 经 onSave 第三参→父组件（缺参 fail-fast）→`expected_revision`→Store 原子校验。source-only 更新不误拒；真实 config/target 变化、读失败、错误 ID、失败后晚到、unmount/peer 断连/busy、双击均 0 次 configure 且草稿保留；读后并发写保持 `REVISION_CONFLICT` 不重试（activity-config-draft-825 六场景均落库）。✅
5. **图片 auth hash**：`model-config.ts` 继承条件（use_main_auth + `endpointsMatch` + 协议缺省相等）与逐字段 `inherited ?? configured` 与 `resolveVisionLlmConfig` 逐字对应；extra_headers 键排序稳定；全缺省时数组与旧公式同形（hash 兼容）；OCR 固定 `'ocr'`；label 仅 host/model/protocol 无 key/header 值。39 组矩阵对照真实 resolver 验证 standalone 失效、被覆盖/不匹配不误失效、键序重排不失效。✅
6. **测试隔离**：`require-isolated-config-825` 首 import 校验 `CMSPARK_DATA_DIR` 位于官方 runner 的 `CMSPARK_TEST_RUN_DIR` 内；负向子进程删除 runner 环境后拒绝执行且 sentinel config 未变；runner 与 preload 链路真实（隔离执行 12 PASS 佐证）。✅
7. **Windows CI 入口**：native lane 同一步骤追加 `activity-apps-825` 与 `activity-scope825-native`，`CMSPARK_ACTIVITY_NATIVE_758=1`；两用例断言 `GITHUB_ACTIONS`/`RUNNER_OS`，沿用 Surface650 lease，断言前台不变、最小化/隐藏/无窗口仍可发现、Probe 拒绝不可采集态、pending 清理、侧栏零像素、嵌图保留、resize/独立窗路径；CPU doubles 未被冒充 native（平台 skip + 报告如实区分）。✅

## 实际 Blockers

**未发现。** 逐项检验的候选项（>4096 窗口枚举失败、Apps 15s 超时、CJK 分词空格、手工非 win.* 标识+范围勾选）均为显式 fail-closed 错误或已在 UI/文档缓解，不构成越权放行、隐私泄漏或验收路径破坏。

## 必要 Nits（不阻塞）

- `activity-windows.ps1` Apps：EnumWindows 达 4097 时抛 `APP_LIST_LIMIT_EXCEEDED`，但该上限触发主体是**顶层窗口**而文案称“运行进程超过 4096 项”，极端多窗口机器会整单失败且提示语义不准。建议区分消息主体或按进程取窗口；保持 fail-closed 即可。
- Apps PS 调用沿用 `runPs` 默认 15s；重度机器上 `Get-Process`×`FileVersionInfo` 可能超时（producer 测试用假 Get-Process，未量测真实耗时），结果是可重试的显式错误，但建议为 `-Mode Apps` 设更大有界超时。
- 手工填入非 `win.*` 标识并勾选“仅记录指定对话”时，保存报“聊天应用范围无效或重复”，未指明是哪个应用。
- 测试基建观察项：`activity-apps-825` native 用例两次 `lease.retain()`（gui+headless）对应 finally 一次 `lease.settled()`，需在 hosted CI 确认 `withSurface650` 记账语义（若为计数制会挂起而非静默通过，属 CI 可见项）。
- CJK OCR 词间以空格 join，exact 匹配对分词敏感；UI 已预填实测值并文档建议保存 ≤20 个完整变体，维持现状即可。

现有测试未覆盖上述 nits 的原因：producer 测试以假 `Get-Process` 替身不量测真实窗口数/耗时；native lease 路径只能在 hosted Windows 执行；CJK 分词行为依赖真实 Windows OCR 引擎，CPU double 固定返回分词结果。

## 是否允许 commit 进入最终 CI

**允许提交进入 hosted CI。** 剩余门禁不变：hosted Windows native（apps/scope 两用例真实执行）、完整 portable+native 矩阵、最终 PR/main 精确检查、三平台 Release dry-run、tag 发布；任何一项未绿前不得宣称产品通过或发版。本复审仅为提交 CI 的源码门，不提前批准发版。

VERDICT: APPROVE_WITH_NITS
