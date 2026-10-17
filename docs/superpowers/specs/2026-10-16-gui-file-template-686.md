# Windows GUI 本地文件模板：首个受控 profile

GitHub: #686 (https://github.com/nehcuh/cmspark/issues/686) · Parent: #70

Status: **CONTRACT CANDIDATE ONLY — NOT APPROVED FOR IMPLEMENTATION**

Issue-first: #686 created 2026-10-16T15:08:42Z, remote body verified before this document. Root chose target candidate A for drafting; this choice is not the final independent contract approval. Source baseline: `243109e07ddb3ab1940c342f3a24d2cccd212de1`. No implementation, native launch or user configuration change accompanies this spec.

## 1. 用户可见结果与范围

用户已在 App 白名单登记、且符合下述唯一 profile 的 Windows GUI exe，可以在自己的 App 配置中声明一个「打开本地文本文件」模板。模型只能提供这个 app token、该模板 ID 和一个文件路径。每次完整展示实际 app、模板、风险和最终 argv，取得一次 L2；危险模板还必须通过原 origin-bound Hello/手输码第二因素，之后最多启动一次这个已批准操作。

仅支持 Windows、现存普通 `.txt` 文件、精确固定的 Notepad++ profile。不是任意 GUI `.exe` 支持声明；不增加应用、安装/更新软件、自动登记 portable、选择 cwd/env、自由 argv、URL、CLI、AUMID、vault、解释器、模型自定风险或坐标/读取权限。`host_cli` 已有实现不重做。L0 无参 launch 的原政策/线程信任/跨平台行为不变。#686 只交付该子范围，#70 的其它模板/URL/gallery/drift 等不因此关闭。

模板由 owner 在既有受校验的 config 中声明。AppsPanel 仅显示名称/用途/风险及不支持原因；不新增模板编辑 WS/模型 tool，不开放全局 `apps.enabled` UI 写开关。owner 未配置模板仍为原 L0。

## 2. 唯一支持目标与解析依据

Profile literal: `npp-8.9.8.1-x64-local-text-v1`。

- 唯一受支持 exe：官方 Notepad++ **8.9.8.1 x64 portable** 中的 `notepad++.exe`，文件长度 **8,546,288 bytes**、SHA256 **`c52c9ed2ec6d0b5b3f243b29f2124f98db56b6ba92bb42a9af2665709464b3cf`**。必须就是该 app 当前登记的 canonical exe；profile 标记/文件名/owner 自填 sha 单独均不是身份证明。执行时先以该精确长度拒绝异常输入，再实际哈希匹配编译进 profile 的已审固定身份；不同内容/版本拒模板，不覆盖原登记、不自动 re-approve。既有 signer/user-writable policy cap 继续适用。
- 官方 tag commit `dd40fe45598791e9aa38f3aeb200e10fb3d6338a`；release portable x64 archive SHA256 `beddf5548e75c97930d1575ba1c7d113e6e2b33d0a200310e734ca08e225f414`。本合同仅下载公开 archive 字节并在内存核验成员哈希；没有把 exe 写出、运行或安装。此 source/archive 关联不是 reproducible-build 证明，未来真实 Windows 必须再验该精确发布目标。
- 固定 argv **恰五项**：`["-multiInst", "-nosession", "-noPlugin", "-ro", canonicalFile]`。前四项为 profile 内置字面值，owner/model 不能替换、移位或补开关；第五项只来自已校验的文件槽。无 `-settingsDir`、`-openSession`、`-pluginMessage`、`-z`、打印、工作区、递归、response 文件或其它可选开关。
- 实际 `winmain.cpp` 自定义 `parseCommandLine` 以空格/tab 分割，双引号包围文件参数；固定开关被 exact lookup 消费，余项变成文件列表。后续 `FileNameStringSplitter` 再用引号界定文件并有 MAX_PATH=260 容器。因此无内部引号/尾反斜线的绝对普通文件值，经 Node 默认 Windows argv quoting 后应保留一项；**这不是 `shell:false` 自动蕴含的结论**，须对实际 argv receiver 和上述精确目标 parser 的 Windows 接线验收。
- `-multiInst` 防止这次参数转交给已有、可能加载插件的 instance；`-noPlugin` 禁插件装载；`-nosession` 不加载上一 session；`-ro` 是编辑器只读标记。它们不是 OS 文件写沙箱，也不承诺目标应用无普通配置读取/其它原有启动行为。

### 2.1 真实 profile/session 歧义与有限拒绝

实际 `NppIO.cpp` 的 `doOpen` 先检查 user `sessionExt` / `workspaceExt`，相符时会加载 session/workspace，即使未传 `-openSession`。不得只用 `.txt` 或 `-nosession` 声称普通文件语义已经闭合。

本片只支持 **portable-local**：exe 同目录存在非 reparse 普通 `doLocalConf.xml`；排除会被该版本 Program Files 特例忽略 local 标志的布局，保守拒绝位于系统 Program Files / Program Files(x86) 根内的目标（由真实系统目录解析，不猜本机盘符）。exe 同目录 `cloud\choice` 必须不存在；一旦存在或存在性不确定即拒，不读取其正文/跟随 cloud 路径。exe 同目录 `config.xml` 必须存在、普通非 reparse、UTF-8（允许 UTF-8 BOM）、不超候选 bound；缺失拒，不能让 app fallback copy model config 后假称已校验。

只对这个固定 config 做 bounded metadata preflight：严格解析 XML，不支持 DTD/实体定义/外部实体/其它 encoding、重复 `sessionExt` / `workspaceExt` 或结构不确定；只认 `NotepadPlus/GUIConfigs/GUIConfig` 下同名设置。两者缺失/空表示默认空；非空值按该 pinned source 的可选前导点和 Windows case-insensitive 扩展比较归一化，若等于 `.txt` 则拒。其它设置不逐项禁止、不回传/记录正文；不能把普通 profile 活动升级为「零外部读取」承诺。配置故障/过大/unknown 布局显示“此 profile 暂不支持模板，原无参启动仍可用”。

不创建/删除 profile，不写 config.xml，不改默认配置、不引入临时目录/cleanup claim/服务。read-only preflight 仅为该操作的 native admission；不会给模型泛化的 metadata/file-content 读取工具。

## 3. owner 配置与工具形状

候选模板对象封闭为：

- `id`: `[a-z][a-z0-9_-]{0,31}`；在当前 app 内唯一。
- `name`: 非空展示文字，最多80 UTF-16 units；仅数据展示，控制符/换行拒。
- `profile`: 上述唯一 literal。
- `risk`: 只能 `state-changing` 或 `dangerous`，host 配置提供；没有只读 silent risk。打开只读编辑器仍改变桌面状态，必须 L2。
- `argv`: 必须结构上精确等于四个固定 literal 再 `{ "file_slot": "file" }`；不是字符串模板/替换/正则。此显式形状便于 owner 看清配置；不能因手改 config 容忍其它字面参数。

模板最多一个；槽名固定 `file`，不增加动态 slot schema。适用 app 必须 `win.app.*` / kind=gui、enabled、有上述 exe、没有 aumid/bundleId/cli_manifest，现有 LOLBIN/vault conservative identity guards 全部允许且 `templatesAllowed` 真。任何受保护身份都不得被另一普通字段洗白；不把 Terminal/browser 例外导入模板。

`host_app` 按 action 分型：原 `launch` 保持既有支持语义；新增严格 `run_template` 只接收 `{ app, action, template, params:{file}, security_token? }` 和实际 host 内部注入字段。模型不能填写内部 prepared/approval/argv/risk/exe/cwd/env/thread identity。用户输入层 `additionalProperties:false`，嵌套 params 同样严格；unknown/action/slot/污染 key、重复或无效模板先于确认/副作用拒。不得通过 schema strip 静默把一个本应失败的模板调用降为 L0 成功。

Malformed template config 继续沿用既有 schema-failure entry-disabled/可见错误语义，不拖垮其余 entries。`templates:[]` 或 absent 向后兼容；非 Windows/其它 App 模板明确拒。Apps.list/read-only AppEntry 只投影 id/name/profile/risk/槽说明，不泄露 exe/profile 文件正文。模型索引在既有总20条 app cap 内列可用模板 ID/risk，name沿用80字符 scrub；无模板 app 仍标 launch-only。

## 4. 文件槽准入与候选预算

以下都是 **本票待 root 正式批准的新候选 bound**，不是历史已有数值或已获编码批准：

| 项 | 候选 | 来源/理由 |
|---|---:|---|
| 每 app 模板/每模板槽 | 1 / 1 | 首个单文件 profile，避免通用模板组合；后续扩大另审 |
| 最终 argv 项 | 5 | 四个已核 parser 固定开关+一个文件，不是可配置上限 |
| id / name | 32 ASCII / 80 UTF-16 | id 对齐现 App slug上限；name复用现索引scrub的80，仍新模板字段约束 |
| 输入和 canonical 文件路径 | 1–259 UTF-16 units | pinned splitter 的260容器保留NUL；输入也先限，避免归一化前无界工作 |
| config.xml读取 | 64 KiB | 只为小配置判定扩展映射；大配置诚实不支持，不截断后批准 |
| 目标文件 size | 0–1 MiB | 首片交互文本打开规模，metadata size即可检查；不声称目标内容已读/验证UTF-8 |
| canonical template JSON | 4 KiB UTF-8 | 一个小封闭对象；输入先 bound，再解析/比较，无自由 argv |

文件输入只能 drive-absolute Windows 路径 `X:\...\name.txt`。正向字符类别为 Unicode字母/组合标记/十进制数字、ASCII普通空格、`_ - . ( ) [ ]` 加结构所需 drive colon 和反斜线。禁止双引号/单引号、C0/C1/DEL/换行/Unicode分隔或双向控制、`% ! @`、通配`* ?`、`= ; & | < >`、slash、URL/scheme、UNC/设备/extended-length前缀、非 drive colon/ADS、相对/drive-relative、`.`/`..` 段、段末点/空格、DOS保留设备名；最终 basename 后缀只 `.txt`（ASCII case-insensitive），不是宽泛扩展表。整体值以盘符开始，因此不得作为开关/response文件；字面 `-r`、`/p`、`@file` 均直接失败。普通中文和空格必须正控，不把引号作为用户转义语法。读取输入不trim/插值/环境展开/百分号解码，不通过编码把拒绝字符复活。

使用真实 Windows 规范路径/文件身份确认：original 与 canonical 均为受支持的本地 drive 路径、当前现存普通文件、无 reparse/symlink/junction 逃逸/ADS/网络映射，metadata size 在 bound；不创建文件、不按关联打开、不浏览目录。canonical路径用于预览/argv/绑定，不能批准 A 后改成 B。I/O错误、身份不可证明、消失/目录/超限全拒。首片不新增 owner root allowlist/不复用 host_read 的读取授权；此能力仅让已批准 GUI 打开那条明确路径，不能读取内容到后端/模型。

不许为“安全”读取目标正文/复制文件/改扩展/保存临时内容副本。既有进程以当前用户权限打开原路径，用户后续可手工操作编辑器；`-ro`不代表内容安全沙箱。文件内容漏洞/同用户最终check后替换的 Q4 残余须如实记录，不能宣称 inode绑定等价于目标用同一handle打开。

## 5. 单一不可变操作、L2 与最终 fence

第一次 await **以前**建立一个 request-local App subject watch（复用 configEvents stale-latch 模式），快照 owner 当前 app authority/identity、global enabled、精确选中 template/profile/risk/argv规则；freeze/copy这些值，不保留可变 config alias。相关 host 配置一旦事件中改变，旧请求永久 stale，即使ABA回原值；finally无条件退订。无关 sibling 变化不使请求恢复/覆盖其它条目，不引入全局 generation/tombstone/新 grant。

准备期逐步得到一个 immutable canonical operation：app token+canonical exe及实际hash/identity、template完整对象和risk、canonical文件与metadata身份（dev/ino或可靠Windows等价、size/mtime/ctime）、portable/profile来源和相关值/有界confighash、精确5项argv。preflight使用同一有限规则，在 **每个 await 返回后**检查abort/connection owner/current subject/latch；并复查异步准备期间的 exe/file/profile身份。读config固定metadata不进模型/历史；内部hash不被当隐私脱敏可随意公开。

### 5.1 模板永远逐次 L2

在真实 gate 的最终 require-confirm 条件建立独立 action-aware硬地板：`run_template` 不继承auto、app-launch threadtrust、域白名单、预授权token、god-mode/auto_approve、enterprise/sessiontrust、三旗full cruise/其它skip；也不暴露thread/session免确认复选框。仅改通用可被cruise清除的forceConfirm不符合本合同。原 Q5 taint 不弱化。

对于直接/预授权执行入口，必须有本次真实交互 L2 后的 host-owned操作准入对象/receipt；普通 `security_token` 字符串、其它工具/旧L0的token、可由模型填写的布尔标记不构成 receipt。实现应复用既有 request/execution options 私有通路，在签发 token 与最终消费间关联同一不可变操作，不新增可伪造tool字段/无限全局map。无此可信通路则拒而不是悄悄免确认；需要新持续状态或新authority时必须先报窄合同差异。

预览经已有 `fullPreview` 原样展示 escaped纯文本的 app/name、canonical exe、template/risk、全部5argv含完整文件值和必要不支持原因；不得只用1200字符fallback或渲染可执行Markdown/HTML。索引不带私有路径，L2只向原origin-bound用户通道显示本次路径。后台绑定使用确定性结构化序列化，包含整个canonical operation的相关subject/projection，不能拼接有歧义的 `|` 或只 app|action；issue/validate来自同一helper。原SecurityPolicy token单次消费/2分钟TTL不延长、不新grant。

### 5.2 危险第二因素与执行

owner模板 `risk=dangerous` 时，先本次L2，最终executor再走原 requireAppsBiometric origin-bound Hello/nonce门。cancel硬拒不fallback，Hello明确unavailable才nonce，缺通道/拒绝/超时/断连/abort/error均0spawn。普通L2标签或已有危工具token不是第二因素。软件synthetic验证不能声称真人/物理Hello。

**重要单次token顺序**：现 `validateTokenFor` 成功会删除token。不得像旧dangerousCLI路径那样在两await边界复用已消费token；本新路径先完成准备/L2/所需第二因素，再在最终同步fence一次验证消费对应token，或使用既有独立非消费检查但不可改全局消费语义。必要await（dynamic import、file/metadata读取、probe、Hello等）全部在最终fence之前；每次返回都复检当前operation。最后同步重查latch/current app/template/global、同步支持的file/profile/subject身份、连接/abort、host-ownedreceipt和same binding，单次消费token→同步spawn调用，中间无await。spawn失败也不得复活旧receipt/token。

仅调用已登记canonical exe和精确冻结argv，`shell:false`，默认Windows quoting（不启用windowsVerbatimArguments），无自由cwd/env。原L0引擎继续只[]，不能把模板args传入AUMID/mac分支。不提供stdout权限、不吸收输出当指令。沿用诚实launch evidence（进程在跑不是证明文件确已打开），late spawn error不得假文件成功；模板拒绝不能降成L0。审计只必要token/template/policy/tier/有限reason/耗时/参数摘要，不记正文、config XML、文件路径或新秘密；若既有tool trace存原输入须在实现期真实核其脱敏投影，不假承诺本票消除了所有旧日志。

### 5.3 可证范围与残余

保证host配置事件可见的subject ABA永久失效；外部文件/profile只保证所观测快照及每await后/最终检查的身份相等。不声称捕获外部filesystem所有ABA，不为此加global generation/fs事件服务。Q4同用户最终同步check后到目标自身open的路径race仍存在，按原同用户执行权残余披露；不能用此残余waive确认期间已可观察的变化。

## 6. 原 DoD 对照与失败验收

| #686/原决策 | 必须真实证明 |
|---|---|
| 原unsupported RED | 真validateAppEntry非空模板/host_app schema及gate拒run_template；新permanent在原source实际RED后最小GREEN |
| 封闭配置/输入 | 所有unknown/excess/duplicate/污染/超bound/错误profile/risk/slot/args/URL/AUMID/CLI/vault/LOLBIN在L2前0spawn；accepted rawbytes/中文空格不被悄悄改写 |
| 每次L2 | 实际schema→dispatcher/gate→manager→executor/inert spawn；auto/manual/ai trusted/所有flag组合/直接token入口仍1L2，原L0保旧行为；取消/断连/timeout0effect |
| same operation | 完整preview/binding/finalargv逐字相同；换app/template/risk/argv不能重放；并行/同token重放最多一次spawn，无全局新generation |
| stale/ABA | 每await分别disable/remove/replace/template/risk/global/ABA；mutable alias/非相关sibling/直接reload；相关旧批拒、sibling保留，finally listener无泄漏 |
| file/profile | .txt alias到session/workspace真source反例必须先拒；本地路径/Unicode/空格、config缺失/大/DTD/重复/非法encoding/Cloud/ProgramFiles、文件消失/改身份/映射/ADS/reparse/size边界 |
| dangerous | 实际requireAppsBiometric成功/明确unavailable→nonce/cancel不fallback/deny/error/abort；最终await后失效0spawn，不能用fakeHello称物理验证 |
| 真实Windows | hosted owned真实argvreceiver + pinned NPP parser/固定开关/文件边界正负控；Desktop5.1若用只读metadatahelper也须真Win；验证精确release身份，已有instance不转交，profile别名拒、清理仅ownedfixture无userprocess kill |
| 组合门禁 | 一次sourcefreeze/module host+freshlockedARM/真正非作者/完整要求模型/head所有CI/绿后已授权merge/main所有jobs+实际close，仅Closes686/Refs70 |

真实 Windows 可用，不造永久“没有Windows”外阻。自动化只能证明软件确认接线；需要物理Hello/真人交互的事实独立标NOT_DONE，原Nonce路径真实所需通道则不能用mock冒完成。任何新机器红/REQUEST_CHANGES阻断合并，原失败/设置错误完整留存，无unchanged rerun/skip/retry/预算放宽取巧。

## 7. 触达与风险

T3：新参数化native执行、L2硬地板、第二因素、subject/binding与配置。预计触达 apps/types+profile/prepare+launch有限入口，schema/catalog/index，l2-admission/security-policy/companion-dispatch，AppsPanel/extension只读类型与相关永久tests。不是通用templating/CLI框架；实现必须以真实diff再冻结最终blast，不能把本节当全文件覆盖授权。现app grant/disable/remove/sibling防回滚和CLI/vault全部保留。若实现发现需新字段/数值/authority超本合同，先报具体缺口；普通已批准bugfix无需每行再开设计。

## 8. Primary sources / 原决策

- #686正文、#70正文/四comments，特别最新comment6215078318。
- `docs/decisions/app-tab-design-draft.md`末Owner1/2，D1/D3/D6/D12；`app-tab-design-adversary.md`；`windows-host-use-review-handoff.md`附录B。旧L1-in-P1/auto泛跳与“CLI未做”不是当前事实。
- [Pinned parser](https://github.com/notepad-plus-plus/notepad-plus-plus/blob/dd40fe45598791e9aa38f3aeb200e10fb3d6338a/PowerEditor/src/winmain.cpp), [file splitter](https://github.com/notepad-plus-plus/notepad-plus-plus/blob/dd40fe45598791e9aa38f3aeb200e10fb3d6338a/PowerEditor/src/MISC/FileNameStringSplitter.h), [doOpen/session rules](https://github.com/notepad-plus-plus/notepad-plus-plus/blob/dd40fe45598791e9aa38f3aeb200e10fb3d6338a/PowerEditor/src/NppIO.cpp), [config resolution](https://github.com/notepad-plus-plus/notepad-plus-plus/blob/dd40fe45598791e9aa38f3aeb200e10fb3d6338a/PowerEditor/src/Parameters.cpp), [release](https://github.com/notepad-plus-plus/notepad-plus-plus/releases/tag/v8.9.8.1)。具体有限source片段/完整公开blob和identity receipt均在合同证据包，未执行上游程序。
