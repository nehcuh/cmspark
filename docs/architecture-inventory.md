# 工程实现清单

本清单关联隔离治理记录与基线提交 `36af0151`，用于定位真实消费者及评估下一次改动。当前依赖边及强连通分量可用 `node scripts/architecture-dependencies.mjs --json` 从锁定的 Companion 依赖生成。

## 进程、协议与运行状态

视觉模型的网关认证继承与请求地址由 `llm/vision-config.ts` 解析。工作中心消费解析结果，并使用原有指纹格式保存用户对目标模型的授权。

| 边界 | 写入方、读者及生命周期 |
| --- | --- |
| Chrome 扩展 | MV3 background 负责浏览器权限与操作。侧栏 `useWebSocket` 经 background 接收消息，`agentStore` 维护 UI 投影、已选择线程与历史。聊天历史的成功与失败都按回包中的线程归属更新，当前选择的重试状态由 reducer 持有；持久化、断线与会话操作各有独立生命周期。 |
| Mini 与原生桌面 | 小窗服务负责会议网页和本机桥接；原生宿主经 desktop 通道进入后台。线程、工作区、PTY 与 ACP 的句柄、确认及序号归各自连接。Swift 与 C++ 消费 `desktop/capabilities.ts` 派生的协议能力名称。 |
| Companion | `ws/lifecycle.ts` 管理已认证的连接及断线，`ws/tool-forward.ts` 管理目标、超时及租约，`llm/active-runs.ts` 持有运行控制器、代次和面板归属，`message-router.ts` 处理请求。`security/companion-confirmations.ts` 持有跨界面确认，`server.ts` 组合服务。移除这些依赖前须确定初始化、订阅和销毁的唯一责任方。 |
| 模型、上下文与工具目录 | provider 负责供应商协议及传输重试。预算和交接拥有各自数据模型。MCP 聚合器提供已连接工具清单，管理器提供 schema 和会话；公开 schema、执行器与授权分别在调用链对应的位置。推理时选择按需加载的工具只来自已有授权目录。 |
| 会议与文件 | 语音服务持有在途转写，会议存储持有音视频、时间索引、文本与纪要。停止采集、后台确认、会后恢复与 UI 关闭分别有入口，离线重启后的中断范围由获得端点的服务恢复。 |
| 配置与日志 | `config.ts` 管理配置缓存、修订检查和变更事件。目录按安装资源或选定数据 profile 解析。日志轮转按 UTC 日期或实际大小，原子替换重试限于文件系统瞬态错误；LLM 重试、MCP 重启和用户确认都有自己的副作用边界。 |
| 构建、测试与发布 | 两个 npm 项目分别锁定工具链，扩展通过 Plasmo 打包，Companion 用 tsc 与 esbuild，安装器额外封装所选平台的 Node 与原生库。发行矩阵在 `.github/workflows/build-installers.yml`，发布在 `release.yml`。平台签名/摘要检查与业务权限分别验证。运行普通 Companion 测试时，标准测试入口为子进程分配独立数据目录。 |

## 重复实现的基线

对两个源码树中有名称和函数体的 TypeScript 函数，用 TypeScript printer 去掉注释，按相同函数体分组，仅计打印后至少 85 个字符且出现两次的组。共 72 组、149 个声明。嵌套的页面执行函数及每端打包的代码也会计入。下表保留原排序编号、符号与相对源码路径；重复出现在同一文件的声明标出次数。符号随修复迁移后的所有者见[治理记录](architecture-governance.md)。

### 跨客户端的协议与投影

第 059 批复扫 911 个源码文件，得到 59 组重复函数体、118 个声明，包含生成的客户端投影。

第 052 批后以同一规则复扫 910 个文件，仍匹配到 72 组、149 个声明，成员已变化。其中 27 组含按源文件生成的客户端副本，8 组位于 NotebookLM 页面注入代码。扫描结果包括这些部署边界，治理进度按具体规则的归属与真实调用方记录。

推理力度、输出预算、模型目录和图片探测分别由第 008、015 批建立了生成和漂移检查。第 062 批把输出上限的读写规则并入同一预算策略，覆盖基线第 42、61 组。相关线程的时间、CJK 分词与排序由第 030 批统一生成。侧栏和服务端分别保留各自的结果数量，图只对已裁剪的快照计算。安全档位的状态文字与实际授权分别由界面和服务端消费。掩码密钥与页面草稿的空值也有独立语义。

| 组 | 基线符号 | 源码位置（相对于对应包的 src） |
| --- | --- | --- |
| 2 | `directProvider` | `Companion / llm/reasoning-effort.ts`、`扩展 / sidepanel/utils/reasoning-effort.ts` |
| 3 | `likelyMultimodal` | `Companion / llm/likely-multimodal.ts`、`扩展 / sidepanel/components/vision-reuse-logic.ts` |
| 5 | `modelSpec` | `Companion / llm/reasoning-effort.ts`、`扩展 / sidepanel/utils/reasoning-effort.ts` |
| 6 | `calculateChatOutputBudget` | `Companion / llm/chat-output-policy.ts`、`扩展 / sidepanel/utils/chat-output-policy.ts` |
| 7 | `reasoningParams` | `Companion / llm/reasoning-effort.ts`、`扩展 / sidepanel/utils/reasoning-effort.ts` |
| 11 | `reasoningWireEffort` | `Companion / llm/reasoning-effort.ts`、`扩展 / sidepanel/utils/reasoning-effort.ts` |
| 13 | `glmCodingPlan` | `Companion / llm/reasoning-effort.ts`、`扩展 / sidepanel/utils/reasoning-effort.ts` |
| 15 | `estimateDataUrlPayloadBytes` | `Companion / image-data-url.ts`、`扩展 / background/image-extract-utils.ts` |
| 17 | `findRelatedThreads` | `Companion / threads/related.ts`、`扩展 / sidepanel/utils/thread-related.ts` |
| 18 | `normalizeProbeUrl` | `Companion / llm/native-vision-probe-cache.ts`、`扩展 / sidepanel/components/vision-reuse-logic.ts` |
| 24 | `deriveAutopilotTier` | `Companion / security/autopilot-tier.ts`、`扩展 / sidepanel/components/autopilot-tier.ts` |
| 25 | `tierShortLabel` | `Companion / security/autopilot-tier.ts`、`扩展 / sidepanel/components/autopilot-tier.ts` |
| 27 | `textBlob` | `Companion / threads/related.ts`、`扩展 / sidepanel/utils/thread-related.ts` |
| 29 | `previewDataUrl` | `Companion / llm/image-preview.ts`、`扩展 / sidepanel/utils/image-compose.ts` |
| 33 | `uniqueIndexThreads`、`uniqueGraphThreads` | `Companion / threads/thread-manager.ts`、`扩展 / background/thread-graph.ts` |
| 35 | `effectiveContextWindow` | `Companion / llm/chat-output-policy.ts`、`扩展 / sidepanel/utils/chat-output-policy.ts` |
| 37 | `isMaskedApiKey` | `Companion / config.ts`、`扩展 / sidepanel/utils/normalize-config.ts` |
| 38 | `modelSuggestions` | `Companion / llm/reasoning-effort.ts`、`扩展 / sidepanel/utils/reasoning-effort.ts` |
| 39 | `normalizeImageMime` | `Companion / image-data-url.ts`、`扩展 / background/image-extract-utils.ts` |
| 41 | `tagSet` | `Companion / threads/related.ts`、`扩展 / sidepanel/utils/thread-related.ts` |
| 42 | `normalizeSavedChatOutputLimit` | `Companion / llm/output-budget.ts`、`扩展 / sidepanel/utils/normalize-config.ts` |
| 44 | `threadRecency` | `Companion / threads/thread-manager.ts`、`扩展 / sidepanel/utils/thread-timeline.ts` |
| 48 | `normalizePreviewUnavailableReason` | `Companion / computer/preview-availability.ts`、`扩展 / sidepanel/utils/confirmation-preview.ts` |
| 54 | `modelStateMessage` | `Companion / computer/model-state-messages.ts`、`扩展 / sidepanel/components/model-switch-logic.ts` |
| 55 | `normalizeDocumentWarning` | `Companion / file-formats.ts`、`扩展 / sidepanel/utils/document-warning.ts` |
| 57 | `inRelatedPool` | `Companion / threads/related.ts`、`扩展 / sidepanel/utils/thread-related.ts` |
| 61 | `isChatOutputLimit` | `Companion / llm/output-budget.ts`、`扩展 / sidepanel/utils/normalize-config.ts` |
| 69 | `isUiCommandAction` | `Companion / ui-command.ts`、`扩展 / background/ui-command.ts` |
| 70 | `deriveDisplayTier` | `Companion / security/autopilot-tier.ts`、`扩展 / sidepanel/components/autopilot-tier.ts` |
| 71 | `normalizeEndpointUrl` | `Companion / llm/vision-reuse-inherit.ts`、`扩展 / sidepanel/components/vision-reuse-logic.ts` |

### NotebookLM 页面执行

下表八组基线重复来自已退役的三个表单操作流程，第 055 批已删除。创建和来源导入的请求由 `notebooklm/rpc-client.ts` 发出；`background/notebooklm-import-orchestrator.ts` 持有批次状态。每个运行循环只更新自己的批次；发起或重试写请求前确认该批次仍在运行。后台重启从最近一次保存的进度恢复。开发用选择器探测脚本继续消费 `notebooklm/selectors.ts`。

| 组 | 基线符号 | 源码位置（相对于对应包的 src） |
| --- | --- | --- |
| 1 | `openAddSourceDialog` | `扩展 / notebooklm/dom-automation.ts` × 2 |
| 4 | `waitForAngularEnabled` | `扩展 / notebooklm/dom-automation.ts` × 2、`扩展 / notebooklm/notebook-api.ts` |
| 8 | `waitForDomQuiescence` | `扩展 / notebooklm/dom-automation.ts` × 2 |
| 12 | `setAngularValue` | `扩展 / notebooklm/dom-automation.ts` × 2、`扩展 / notebooklm/notebook-api.ts` |
| 14 | `waitForSelector` | `扩展 / notebooklm/dom-automation.ts` × 2、`扩展 / notebooklm/notebook-api.ts` |
| 20 | `waitForRaf` | `扩展 / notebooklm/dom-automation.ts` × 2、`扩展 / notebooklm/notebook-api.ts` |
| 28 | `closeAnyOpenDialog` | `扩展 / notebooklm/dom-automation.ts` × 2 |
| 64 | `currentSourceCount` | `扩展 / notebooklm/dom-automation.ts` × 2 |

### 桌面操作与文件身份

第 016 批合并了按消息 ID 确认写入的实现。其他嵌套函数读取各自连接的 operation、epoch 和 pending 状态。第 057 批统一根目录快照的取样、复核与文件身份字段。终端与工作区各自映射失败，资源库保留缺失父目录和可写版本检查。操作队列、取消与确认回执继续按连接隔离。

| 组 | 基线符号 | 源码位置（相对于对应包的 src） |
| --- | --- | --- |
| 9 | `decide` | `Companion / desktop/local-work.ts`、`Companion / desktop/terminal-work.ts` |
| 10 | `commitLocalWorkMessage` | `Companion / desktop/local-work.ts`、`Companion / desktop/terminal-work.ts` |
| 16 | `chain` | `Companion / desktop/terminal-root.ts`、`Companion / desktop/workspace-files.ts` |
| 21 | `snapshotRoot` | `Companion / desktop/terminal-root.ts`、`Companion / desktop/workspace-files.ts` |
| 30 | `canonical` | `Companion / desktop/local-work.ts`、`Companion / desktop/terminal-work.ts` |
| 34 | `abortPending` | `Companion / desktop/local-work.ts`、`Companion / desktop/terminal-work.ts` |
| 36 | `assertRoot` | `Companion / desktop/terminal-root.ts`、`Companion / desktop/workspace-files.ts` |
| 47 | `lookup` | `Companion / desktop/local-work.ts`、`Companion / desktop/terminal-work.ts` |
| 53 | `identity`、`statIdentity` | `Companion / desktop/terminal-root.ts`、`Companion / desktop/workspace-files.ts`、`Companion / skills/desktop-resource-store.ts` |
| 60 | `emit` | `Companion / desktop/local-work.ts`、`Companion / desktop/terminal-work.ts` |
| 63 | `io` | `Companion / desktop/terminal-root.ts`、`Companion / desktop/workspace-files.ts` |
| 65 | `code` | `Companion / desktop/local-work.ts`、`Companion / desktop/terminal-work.ts` |
| 72 | `retireAck` | `Companion / desktop/local-work.ts`、`Companion / desktop/terminal-work.ts` |

### 侧栏视图与采集

第 060 批迁移了基线第 45 组。技能和知识站点视图通过 `useSiteGroups` 消费当前窗口的活动标签，扩展构建使用 `skills/site-matcher.ts` 的生成投影。图标映射和形状转换只负责渲染。第 052 批将听写的设备选择和麦克风轨道释放收归 `sidepanel/voice/microphone-device.ts`。PCM 和 WAV 采集仍分别拥有各自的上下文、计时器与编码资源。会议混音另有多流轨道的去重与所有权约定。

| 组 | 基线符号 | 源码位置（相对于对应包的 src） |
| --- | --- | --- |
| 22 | `kindIcon` | `扩展 / sidepanel/components/CodingAgentPanel.tsx`、`扩展 / sidepanel/components/CodingSessionShell.tsx` |
| 45 | `matchesSite` | `扩展 / sidepanel/components/ContextPanelHost.tsx`、`扩展 / sidepanel/components/KnowledgeSubPanel.tsx` |
| 52 | `stopTracks` | `扩展 / sidepanel/voice/audio-capture.ts`、`扩展 / sidepanel/voice/pcm-stream-capture.ts` |
| 58 | `asRecord` | `扩展 / sidepanel/utils/redacted-stub-utils.ts`、`扩展 / sidepanel/utils/shell-card-utils.ts` |

### Companion 的域内实现

第 010 批合并了本机 HTTP 文本接收，第 022 批统一扩展 Origin 语法，第 038 批将下表第 26 组的对象保留键规则收归 `security/object-keys.ts`。第 043 批统一第 31 组的语音模型清单读取，第 044 批复用第 51 组的应用路径展开。第 050 批将第 32 组的摘要触发规则统一到 `llm/context-budget.ts`，将结构化交接失败后的回退收归 `llm/context-compaction-summary.ts`。保留 ACP 和 CLI 各自的 taint 状态，避免不同授权域共享可变集合。文件身份、进程是否可执行、原生协议分帧分别由实际平台契约决定。

| 组 | 基线符号 | 源码位置（相对于对应包的 src） |
| --- | --- | --- |
| 19 | `readBody` | `Companion / settings-web.ts`、`Companion / summoner-web.ts` |
| 23 | `parseQuery` | `Companion / settings-web.ts`、`Companion / summoner-web.ts` |
| 26 | `hasPrototypePollutionKey` | `Companion / apps/types.ts`、`Companion / message-router/handlers/config.ts` |
| 31 | `diarizeManifestCandidates`、`whisperManifestCandidates` | `Companion / voice/diarize-manifest.ts`、`Companion / voice/whisper-manifest.ts` |
| 32 | `shouldRunM2`、`shouldRunH1` | `Companion / llm/context-budget-m2.ts`、`Companion / llm/context-handoff.ts` |
| 40 | `isExecutableFile` | `Companion / acp/discover.ts`、`Companion / acp/open-local-terminal.ts` |
| 43 | `scrubTool`、`scrubToolName` | `Companion / threads/run-progress.ts`、`Companion / tool/execution-contract.ts` |
| 46 | `forbidden` | `Companion / settings-web.ts`、`Companion / summoner-web.ts` |
| 49 | `vaultPathIsBrowser`、`isBrowserVaultExePath` | `Companion / computer/policy.ts` × 2 |
| 50 | `hostOk` | `Companion / settings-web.ts`、`Companion / summoner-web.ts` |
| 51 | `expandEnvVars`、`expandEnv` | `Companion / apps/add-flow.ts`、`Companion / apps/presets.ts` |
| 56 | `statInodeDev` | `Companion / host-use/darwin/host-integrity.ts`、`Companion / tray/swift-tray-bridge.ts` |
| 59 | `isChromeExtensionOrigin` | `Companion / voice/stt-handlers.ts`、`Companion / voice/whisper-handlers.ts` |
| 62 | `isAcpHandbackTainted`、`isCliOutputTainted` | `Companion / acp/taint.ts`、`Companion / apps/cli-q5.ts` |
| 66 | `clearAcpHandbackTaint`、`clearCliOutputTaint` | `Companion / acp/taint.ts`、`Companion / apps/cli-q5.ts` |
| 67 | `markAcpHandbackSeen`、`markCliOutputSeen` | `Companion / acp/taint.ts`、`Companion / apps/cli-q5.ts` |
| 68 | `parseSwiftLine`、`parseSummonerLine` | `Companion / hud/protocol.ts`、`Companion / summoner/protocol.ts` |

## 存储、权限与客户端的边界

| 议题 | 已确认的消费者与决定 |
| --- | --- |
| 侧栏会话选择 | `sidepanel/store/thread-selection.ts` 管理选择修订号、两槽历史缓存、会话设置和删除后的选择。列表和更新在 reducer 中读取当时的会话；WebSocket hook 在提交选择后请求历史，本地持久化负责记住目的地。启动代次和导航目标的判断由 `navigation/startup-destination.ts` 持有。 |
| 聊天消息与回执 | 侧栏和 Cockpit 使用同一份 `store/transcript.ts` 合并消息。服务工作进程回显普通发送，Companion 确认持久消息并合并轮中引导。旧版磁盘历史可能缺少客户端 ID，面板保留无法确定归属的本地待确认行。 |
| 图与列表中的相关线程 | 两端共用同一套排序和时间取值，均默认最多 200 条边，保留共享标签。扩展额外标注边的种类，默认显示三个相关线程，服务端默认返回五个。扩展可离线算图。 |
| 多浏览器与标签页 | `ws/tab-url-cache.ts` 以数值标签 ID 缓存 URL；`ws/tool-forward.ts` 依据连接选择接收方。两个浏览器的相同 ID 需要有明确的归属、断线处理和路由选择协议。单纯把缓存键改为字符串无法决定其他调用方应该选择哪个连接。 |
| 本机协议 | `desktop/capabilities.ts` 是能力名称来源。Swift 与 C++ 仍须在自身进程校验原始请求。主机的文件、终端与 MCP 通道分别持有授权和取消状态；框架通用的「全部停止」不能表达这些所有权。 |
| 原生交付 | Windows 使用命名管道和 Job，macOS 使用 AppKit、WKWebView 与 Accessibility，Linux 的可用桌面路径由实际组件决定。安装器的版本选择与下载摘要验真是独立责任。新增 Linux 原生窗口能力或 Windows 多配置控制管道属于产品兼容性决定。 |
| 设置、日志、重试 | 配置提交的修订号和嵌套写入状态都在当前进程生效。环境密钥和已持久化的密钥保有不同来源。日志轮转尽力完成，写入失败不能改变用户操作结果；模型传输重试、上下文溢出恢复和 MCP 重连不共享重放条件。 |
| 运行期组合 | 服务器连接、对话执行控制器和授权确认分别拥有订阅、取消和超时。企业 HTTP 服务拥有状态写入锁和停机门，WebSocket 层在模块加载时提供实时连接与执行器查询。第 053 批后，两个应用的可解析导入图中同步与延后加载均无环。 |
