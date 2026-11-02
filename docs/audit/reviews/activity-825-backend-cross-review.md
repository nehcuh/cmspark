# #825 A + C 后端独立交叉验证

日期：2026-11-02。评审者：`conversation_scope_design`。本 agent 未编写 A（Windows 应用发现）与 C（有效图像处理目标鉴权绑定）的产品实现；本轮只读检查 A/C 产品代码，新增鉴权矩阵测试。未修改 A/C 产品代码、未提交。

## 结论

未发现阻塞问题。A 已将运行进程身份与当前窗口采集资格分离；C 的 target id 按实际视觉配置解析器的 per-field precedence 绑定有效鉴权，并保持无鉴权缺省时的旧 hash。

本机机器验证为 TypeScript、实际 TS 运行路径与受控输入；两项 Windows 专属 Apps 用例在 macOS 明确跳过，仍须 Windows CI 完成实际 PowerShell/原生验收，不能将此报告当成已在 Windows 通过。

## A：身份、状态与无窗口路径

只读核对 `companion/src/host-use/win/scripts/activity-windows.ps1` 与 `companion/src/activity/windows-apps.ts`：

- Apps 与 Probe 共用 `Process-Identity`：同一 session、可解析的实际进程 Path、GetFullPath + 小写规范化、SHA256 UTF-8 生成 win.app_id。身份不依赖 PID、窗口标题或窗口是否存在，因此同 exe 重启与 minimized/hidden/no-window 仍可保留选择。
- Apps 先观察窗口状态，再独立遍历实际 `Get-Process` 结果；窗口列表不决定进程是否入选。无窗口映射明确投影 `none`，不是将它误当可采集窗口。相同 exe 的多个进程按固定 visible > minimized > hidden > none 合并状态。
- 产品名称、文件描述、进程名依次作为显示名称；不把标题或进程路径放入 Apps DTO。合法同名不同 exe 保持各自身份，按名称 + app_id 确定排序。
- 实际 PS producer 与 TS decoder 均以 4096 为上限，超限明确报错；不再在 200 时静默截断。A 的边界测试包括 201、4096 和 4097。
- 敏感可执行路径在共同身份生产者中拒绝；TS decoder 再过滤敏感显示名称。无法解析路径或外会话的进程不编造身份。
- Apps 不加载 UIAutomationClient，不请求前台、不读取窗口标题、不采集图片。原 Probe 的前台/密码焦点/无遮挡检查仍在原分支，未由 Apps 的状态放宽。

实际运行既有 A decoder suite，确认 no-HWND 四状态、去重排序、同名独立身份、敏感投影与明确限额；Windows producer 控制与真实 visible/minimized/hidden/no-window 用例在当前平台保持 SKIP。

## C：有效鉴权矩阵

新增：`companion/tests/activity-model-auth-825.test.ts`。第一条 import 为 `./helpers/require-isolated-config-825`；只使用官方隔离 runner，所有端点和密钥均为 inert owned 值，没有 HTTP 请求。每组以 finally 恢复 runner 私有 config 文件并 clearConfigCache，不写本机实际配置。

测试不是仅对照 hash 实现，而是在每次变更后调用实际 `resolveVisionLlmConfig(activityVisionConfig(config))`，先确认真实解析后的字段变化/不变，再检查 target id 和旧 consent 状态。

| 组 | 覆盖与实际断言 |
|---|---|
| Standalone 五字段 | auth_style、client_header_profile、claude_code_compat_version、extra_headers、anthropic_version 各自有效变化 -> resolver 字段改变、id 改变、旧图片授权失效 |
| 继承主模型五字段 | endpoint/model/protocol 匹配且 use_main_auth -> 主字段有效改变，id 改变、授权失效 |
| 被主字段覆盖的视觉五字段 | 配置值确实改变，但实际 resolver 字段不变 -> id 和授权保持 |
| 主字段逐项缺省 | inherited field 为 undefined 时逐项使用视觉字段；其有效变化仍使 id 改变 |
| 不匹配的主模型鉴权 | endpoint、model、protocol 三类不匹配 × 五字段 -> resolver 继续用视觉配置，改无效主字段不改变 id/授权 |
| 协议缺省与规范化 endpoint | vision 缺省 openai 与显式主 openai、URL 尾斜杠/模型大小写匹配时，绑定与真实 resolver 一致 |
| 旧缺省 hash / OCR | optional protocol/use_main_auth/五鉴权字段均缺省时，hash 等于旧数组布局；OCR 固定为 ocr，不扩张为语义模型授权 |
| headers 插入顺序 | standalone 与 inherited 两种模式都显式清空再重建反序 headers，确认真实 resolver 对象顺序确实改变，但语义相同的 id 与授权保持；公开 label 不含密钥和 header 值 |

8 组共 39 种矩阵配置/变更场景，涵盖实际 resolver 的有效/无效字段边界；没有修改 hash 或请求解析器来使测试通过。

## 机器证据

```sh
source "$HOME/.nvm/nvm.sh"
nvm use 22.23.4
./node_modules/.bin/tsc -p tsconfig.test.json --pretty false
node scripts/run-tests.mjs .test-dist/tests/activity-model-auth-825.test.js .test-dist/tests/activity-apps-825.test.js
```

日志：`/tmp/cmspark-825-auth-apps-isolated.log`。退出码 0；12 PASS / 2 Windows 专属 SKIP / 0 FAIL。

本轮首次矩阵验证后，额外以只读 SHA256 比对确认实际 `~/.cmspark-agent/config.json` 与恢复审计摘要一致（未输出配置或凭据）。矩阵配置均只写 runner 生成的私有数据目录。

Windows CI 应运行：

```sh
CMSPARK_ACTIVITY_NATIVE_758=1 node scripts/run-tests.mjs .test-dist/tests/activity-apps-825.test.js .test-dist/tests/activity-model-auth-825.test.js
```

## 剩余门禁

Windows 原生及 PS producer 两项需 CI 实际通过；产品整体仍需独立 B/UI 验证和用户指定的 GLM 驱动 Claude 复审。本结论不代替这些门禁。

VERDICT: APPROVE
