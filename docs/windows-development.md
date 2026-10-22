# Windows 开发与失败定位

安装器与 ZIP 卸载的进程查询先以固定两名称 WQL `-Filter` 请求 `node.exe` 或 `cmspark-agent.exe`，随后仍执行原完整 Name／ExecutablePath／安装目录和系统 Node 首脚本／模式检查。不得把安装路径拼进 WQL 或以过滤替代所有权检查。NSIS 观察器须匹配真实查询全文，并保留整脚本 BOM／CRLF 字节逆变换。`cim-enter` 在命令调用前，未出现首行不能区分命令解析、查询初始化或 CIM 内部等待；过滤不保证 provider 内部免全扫描，也不证明历史超时根因。原完整 Windows stop／sibling 存活验收及 30 秒上限保留。接口依据：[Get-CimInstance 5.1 的 Filter](https://learn.microsoft.com/en-us/powershell/module/cimcmdlets/get-ciminstance?view=powershell-5.1)。

Windows 继承验收须区分句柄数值槽位与内核对象身份：`GetHandleInformation` 成功只能证明当前槽位有效，不能证明它是父进程的原 protected pipe/process。#480 sibling 夹具在恢复 suspended checker 前，由父进程以不可继承、零访问权副本及 `CompareObjectHandles` 核三份原对象，raw exit mask 与 identity mask 分开保存；真实泄漏、缺少／UNKNOWN 身份、checker 或 cleanup 失败仍拒绝。源码受控反例不认定历史失败槽位的实际对象，历史原因保持 UNKNOWN；原生门禁、权限、原累计时限均不删改，也不重置旧诊断上限。官方接口依据：[GetHandleInformation](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-gethandleinformation)、[CompareObjectHandles](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-compareobjecthandles)。

跨 Node／Framework 的同一文件须核双向 access/share 兼容。Node lease 的 `wx+` 即使共享 Read/Write/Delete，Framework 默认 `File.ReadAllText` 仍只共享 Read，会拒绝现存写句柄；读取者的 share 必须允许已有 access，不能提前关 owner 或放宽权限掩盖。#723 Job CPU fixture 的修复保持 Read access、显式 ReadWrite|Delete share 和后续原 nonce/claim 校验；真实 Windows 还验证旧读的精确 sharing violation。惰性共享模型／原厂源码链不等于已观测某次 CPU 内部异常，也不等于 native 窗口身份成功。原厂依据：[Framework StreamReader](https://github.com/microsoft/referencesource/blob/ec9fa9ae770d522a5b5f0607898044b7478574a3/mscorlib/system/io/streamreader.cs)、[CreateFile 的双向共享规则](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew)。

适用于 coding agent 和贡献者。先按当前 Issue 的原始 DoD、精确 head/main 和实际失败阶段定位；历史 Windows 红灯不是同一个系统根因。本文是已有调试、隔离与验收纪律的短入口，不新增模型、全仓重测或平台前置门。测试地图见 [TESTING](TESTING.md)，开发约定见 [CONTRIBUTING](../CONTRIBUTING.md)。

## 系统化调试：先亲证，再改动

1. **复现**：固定 commit/tree、运行命令、cwd、Node/依赖、编译源与产物，找到最小真实 producer/原 callback。先核复现输入有效；无法复现就写 UNKNOWN，不修猜测。
2. **观察**：写清 expected/actual，保存原错误、stack、退出码、signal、阶段及 setup 失败。公开共享只用已允许的有限投影；不读取或传播凭据、cipher、恢复明文或私人业务。
3. **假设**：一次提出一个可证伪原因，明确哪条新观察可以否定它；最后阶段、空输出、注册行号、超时或取消都不是根因。
4. **隔离**：用实际源码/实际 payload 的最小受控实验只改变一个变量，保留正负结果。区分夹具、操作器、产品和原生行为，不用手写 shadow 实现代替真实分支。
5. **修复**：亲证后只改原因；保留原拒绝、身份、权限、错误优先级、时限和清理。邻近但无关的问题另记，不顺带重构。
6. **验证**：原反例修前 RED、修后 GREEN；对必要的最小惰性/CPU 复现共核三次，并找同类消费者。**三次不是三次 CI、桌面操作或真实外部调用，也不是全套测试三遍。** 不可安全重复的动作按已批准的真实验收路径执行，并说明证据限制。

## 按改动边界做预检

- **路径与换行**：宿主路径用相应 Node path API；固定 POSIX 的虚拟 FS 则全链使用 posix，不能混宿主 win32。路径相关 producer 覆盖 source/compiled 布局、win32/posix 与误导祖先目录；先辨 `resolve`、`normalize`、`realpath` 的真实职责。Windows 8.3 短名／长名需在同一已声明的 canonical 域比较；JS `realpath` 与 native binding 的实际行为不能凭名字视为相同。保持严格身份断言，不以去盘符、大小写折叠或模糊路径匹配代替。源码提取器喂原 LF/CRLF 两种字节，严格边界不删；checkout、TS printer、模板字面量各自的换行不能混成一次全局归一化。
- **真实契约与消费者**：fixture 来自实际返回/序列化；负控先查当前 dispatcher、role/token/owner API。修改函数、闭包、helper 或 workflow 时用 `rg` 查 import 之外的 readFile/AST/VM/字符串消费者，跑真正受影响 family；不能为过期 fake 删除产品保护或旧安全断言。抽取 return 的动态函数也必须绑定该语句实际使用的平台变量与模块 helper；AST 找到语句不等于执行闭包完整。
- **编译与工具闭包**：使用本次工程的实际 tsconfig/include、ambient shims、文件名、cwd 和 Node 版本；selected 零诊断不冒完整项目通过，诊断为零也不等 emit 成功。从实际 package/lock 核 helper、版本、argv、输出/参数预算；部署完整所需 package scope（含 package.json、相对资源、类型），不只搬 trace 中几个 JS。无关已通过机器按精确输入复用。
- **夹具与操作器**：在 import 应用前设独立 test-owned DATA_DIR，沿用 [preload](../companion/scripts/test-data-dir.cjs)；不改 HOME、不接触 live config，不继承 provider/key/proxy 全环境。保留原 runner 必需的 Windows 允许变量。先核 driver 语法、入口、cwd、目录 UID/ACL、依赖、输出可写性、guard 和真实包路径，再启动；setup 错误保留但不计产品 RED。不靠逐次失败无限加 allowlist。
- **字节与语言语义**：真实 TS 字符串先解码/编译再分析反斜杠，不能数工具展示的转义。中文文件内容与 stdout 编码分开；UTF-8 分块、非 UTF-8 与 stderr 均据真实字节/声明判断，不猜 GBK或更改系统代码页。PS 比较规则、C++ 字符串/SDK 参数所有权必须按真实语言；保留实际 MSVC warning/UTF-8 选项，不压警告换绿。
- **原生身份与生命周期**：请求 Activate/Invoke、收到 ACK 或文件存在，不等于实际前台/效果/完整 ready。固定 owned PID/TID/HWND/对象身份与同次请求；数字 HANDLE、MainWindowHandle、标题或字节相同不独立证明所有权。ready JSON 完整发布后才可见；成功终态、exit、stdio close、cancel 与 cleanup 分开。槽和共享桌面 lease 保留到真实 close/teardown，不能用 UI closed 或 timeout 提前释放仍存活的 worker。
- **64 位文件身份**：`lstat` 与打开后的 `fstat` 比较 device/inode 时，两端都使用 `{ bigint: true }`。不同的 64 位值转换成 JavaScript Number 后可能相等，不能据此放行替换文件。正控须允许相同的大整数身份，负控须在读取 transcript 前拒绝不同身份；保留真实文件替换回归。CPU 精度反例不独立证明某次远端失败的实际文件 ID。

以上只按本次影响选择必要证据；不是要求每个文档或普通改动执行全部原生/全仓测试。

## 已证类别的公共仓库案例

这些回归载体可直接读源；它们不解释其它 UNKNOWN 的 Windows/原生失败。

| 已证类别 | 公共代码案例 | 要保住的验证目的 |
|---|---|---|
| 编译目录的正斜杠判定漏 Windows | [#464 fixture 路径](../companion/tests/github-comparison-464.test.ts) | source/compiled 都读取正确原 fixture，不去盘符或把 hint 当实际路径 |
| LF 提取留下 CR，末尾边界错位 | [#476 native receipts](../companion/tests/desktop-native-receipts-476.test.ts) | 原完整 callback 同时核 LF/CRLF，保 primary failure 与所有 cleanup |
| exists 时 JSON 尚未写完 | [#605 protocolFixture](../companion/tests/integration/cross-os-process-605.test.ts) | 独占 pending 写完/关闭再 rename；实际写失败不宣布 ready，不吞 parse 错误 |
| 8.3 短名与原生返回长名落在不同断言域 | [#726 原生 picker 回归源](https://github.com/nehcuh/cmspark/blob/a4bbb5754b1264dc1f9627dba168d1d873328cb1/companion/tests/workspace-picker-windows-native-726.test.ts) | 已核该次真实 OK／绑定后严格路径断言失败；不能把 `fs.realpathSync` 等同 native canonicalization 或放松最终同根断言 |
| fake 缺新增角色查询，首错污染后续 token 计数 | [postauth dispatcher 回归](../companion/tests/acp-postauth-id-563.test.ts) | 补真实只读接口，保 worker/foreign/replay 与单次 token 断言 |
| 文件正常但管道解码不可判定 | [#731 字节 producer](../companion/tests/shell-output-encoding-731.test.ts) | 精确声明才解码，不明就标注；CPU 字节 seam 不能冒真实 Windows echo/type |

Registry／#732 已认识过 8.3 差异，但未把这个已证类别升级为共享路径预检，#726 再次遗漏；修单个 fixture 后还须检查同类实际消费者。本例是已认证的强证据，不解释 #725 worker 长 pending 或 #735 原生未知原因，也不声称所有 Windows 失败同根。

## 收敛与交付边界

- 每轮先绑定官方 head/tree/run/attempt、完整批次与实际终态。多段 TAP footer 要分别累计；PASS、FAIL、CANCEL、SKIP、INCOMPLETE 分开。普通 exit0、上传成功或某一阶段通过不等整个原生 case 成功。
- 两位真正非作者的互盲源码意见、CPU/ARM 和真实原生验收各有边界；都不相互替代。原生 DoD 必须在精确新 head 的真实 Windows 与所要求 main 路径上验证，不以 macOS/Linux、VM/DOM、编译或旧 head 代替。
- 不靠延长 timeout、sleep、重试、skip/COE、弱断言、权限放宽、恢复焦点或无变化 CI rerun 消红。若需要改变实验/合同，先陈述已证缺口和原 DoD，由负责人裁决；新的观测字段也不能无限按轮追加。
- 同一问题最多三轮修复/复审，之后负责人缩小或重想方案；换目录/packet 名不重置轮数。首轮读完整差量，之后仅核受影响增量，复用字节/输入未变的有效意见与机器；NIT 不触发新 CI，不追加第三/第四必需模型。

## 新增依赖和窗口状态的短检查

- 修改生产函数依赖后，检查删除 import 后执行函数的 VM/AST/readFile 消费者。真实依赖须同时进入消费端 import 和 VM globals；只跑被修改函数的测试会漏掉旧消费端的 ReferenceError。#723 的 `transient-rate-feedback-730` 回归保留了这个失败。
- 前台就绪必须核最后一个可能改变激活的操作。WPF 最小化会调用 SW_MINIMIZE，API 允许激活下一顶层窗口；先激活另窗再最小化不能证明最终前台仍是另窗。当前修复候选只调整原操作顺序，CPU 正负控不冒真实 Windows 验收，也不证明历史唯一原因。禁止补救焦点或放松前台断言。
- 首条 worker 消息的 schema 与终止路径先查真实 producer：font-cache 消息没有 `ok` 字段，observer 的 false 不等字体失败；`finally` 主动 terminate 后的非零 exit 也不单独证明崩溃。冷启动耗时的物理原因未证实时保留 UNKNOWN。
- 原生编译的退出码必须绑定实际已终止进程。#723 的真实前置在读取未设置的 `$LASTEXITCODE` 时拒绝，不能初始化 0、猜 compiler 成功或把十余秒解释成 timeout。需要明确原 compiler 的启动／等待／自身 ExitCode，连同下一 executable 消费者审计，保原 flags、stdout、摘要和拒绝。跨 PS 版本的公开源码不证明实际 GUI／PATHEXT／ShellExecute 分类；好／坏源码控制必须用同固定编译器得到真实 0／非零，泛异常不是有效负控。
- 编译同族审计必须沿实际 controller 找到嵌套 builder 的每个 `/main`。Job wrapper／CPU 共用循环时，第一项失败会遮住第二项；前置正控编译实际两份源，负控分别缺失第一、第二 Main，并核对应目标的真实 Int32 非零，第二项负控还须保第一项真实 0。只编译不执行，保原 flags 与真实控制；first-identity 固定编译按下面的明确批准拆分，原生运行／清理45秒及后续门保留；这不定位当前 UNKNOWN 的原生失败。
- 原生 controller 的首错须覆盖同步前置、Promise 和异步事件回调；仅保留 child 退出码或 TAP 字节数不能定位谓词。固定 fd3 的首拒、独立 abort 未决集合、completion／cleanup 有限回执只用于诊断，最多捕获 4KiB，洪泛后继续 drain，不改变原退出；PASS 完成也会 abort 测试 signal，只有实际 Node:test 顶层 timeout 类型可判超时。源码坐标绑定明确原版 SHA；共享 lease 内部不可见细节保留 UNKNOWN，不能用最后阶段猜首因。失败时只上传 owned gate-summary.json 有限投影，绝不上传 raw/profile/凭据。
- 重建子进程环境时须核后续真实消费者。固定 CFT155 支持的 Native Messaging legacy 分支需要 ComSpec；Chrome Job 只从同 admitted SystemRoot 派生 System32/cmd.exe，不能复制任意父 ComSpec、扩 PATH 或强制 direct feature。六字段排序／UTF-16 双 NUL 和原 CreateProcessW 不变；源码降级正负控不是 C#/Windows 执行，也不证明当前实际 feature/policy 或首错。

## Chrome 原生 DTO 与完整集合证明

同名或说明中同称 UUID 的字段不保证同一序列化形状。先逐字段追固定版本的实际 producer → serializer → consumer，再生成正负 fixture：Chromium 155 的 contextId、documentId 与非 tab Port.sender 分属不同域，不能手工拼成一个不存在的“完整回执”。原生枚举的完整集合也不能在计数前丢掉旧候选；两个未知 profile 的相等不是已知同源正证。源派生 CPU 控制仍不是浏览器实测，也不解释所有历史 UNKNOWN；变更后的原完整业务和真实原生门继续保留。

## Node22 Windows pipe 类型与实际源码消费者

Node22 的 `Stats.isFIFO()`／`isSocket()` 在 Windows 上会固定返回 false，不能据此认定 `fstat` 得到的 fd3 不是管道；同版 libuv 会将实际 named pipe 的 mode 标为 FIFO。有限观察器只接受整数 mode 中真实 S_IFMT 对应的 FIFO／已导出的 SOCK 类型，继续拒绝普通文件、目录、字符设备与未知类型，不按平台无条件放行。可选常量未导出不应在 fixture 中手造；源派生正控应执行实际安装 Node 的 Stats 函数并保持 Windows FIFO 正控必需。参考 [Node22 Stats 实现](https://github.com/nodejs/node/blob/v22.23.2/lib/internal/fs/utils.js#L539-L545) 与 [同版 libuv fstat](https://github.com/nodejs/node/blob/v22.23.2/deps/uv/src/win/fs.c#L2200-L2220)。这是此次新增观察器回归的因果修复，不是历史窗口身份失败原因的证明。

修改实际函数的依赖时，须找全提取该函数的 AST／VM 消费者，不能只验证改动附近的 switch。`handleStateChange` 加入 bridge 断线消费者后，历史连接测试必须显式绑定这个惰性接口，并用真实函数调用次数证明断线通知；原历史、聊天、owner/request/selection 断言不能删除或放松。只读源合并无冲突与类型绿都不能代替这类实际消费者执行。

## 长 CI 的反馈与桌面隔离（#750）

先用连续实际 job/step 元数据分开“在哪一步失败”和“这一步内部为什么失败”。2026-10-21 的20个不同 revision 样本为 Windows10FAIL/10PASS，中位约26.5分钟；18次执行到完整 census 的中位约17.2分钟。这不是固定版本 flake 率，也不能据此把新功能验收错误称系统根因。

CI 的 Windows canonical 与 directed native 使用两个独立 fresh hosted VM，原生动作在各自桌面内仍串行，原 lease/close/身份／预算不变。两路都必须成功；新增 job 不能只凭旧 check 通过而省略。canonical 保全原 npm test／封存，native 自己安装 frontend、执行原 stage:win-scripts 并构建全部必需 fixture；不要借另一 VM 的副作用、已注册窗口、缓存可执行文件或路径当准备正证。末尾被动模块诊断仅观察 canonical sealed baseline。

源码／YAML／LF-CRLF／真实返回契约应在慢原生门之前跑受影响 CPU 控制，避免花半小时才发现确定性夹具错误。下载缓存恢复放实际安装之前，键覆盖两端锁；保原安装和供应完整性。相同 tsc 入口不等于相同输入／输出，未有完整编译闭包等价就不删。分 VM 可缩短关键路径但增加总 CPU／下载，报告真实 head/main 两项成本；不延时、重试、skip/COE 或增加同桌面并发消红。


## 命令 ACK 之后仍要传播 transport 终态（#723）

CDP target／context 的事件等待不能只依靠命令 pending Map：初始 getTargets／Runtime.enable 已 ACK 后，Map 可以为空，socket close 仍须拒绝独立事件等待者；已有 closed 入口不能再发命令，成功与 abort 应退订。用真实完整类及原 reason／并发／迟到事件反例验证，保持原时限和清理。此源码缺口只证明一类错误会被最终 timeout 掩盖，不证明历史 Windows 的 transport 曾关闭；不要因此猜 flag、复活旧 worker、延预算或以 CPU 冒原生。

## 工作流移动也会影响未改过的测试消费者（#723）

拆分 Windows lanes 后，读取 YAML 的旧 companion 测试仍可能要求“原生身份门在 census 诊断之后”。测试文件本身未改，不代表它不受影响：须沿实际 readFile/AST 消费者运行完整 family，并检查两条执行路径的最终条件和顺序。此前本地预检因缺少 owned 夹具目录未执行的八项，不能据此当作“无关”；补齐原夹具环境并保留旧失败，再用原 callback 亲证修正及错误顺序／错 lane 负控。不得靠删除断言、泛忽略新增 step 或跳过原生门消红。

## 明确批准的编译／原生测量拆分（#723）

编译和身份 await 共用45秒、最终落在 registrar，只证明最终等待点，不证明编译或 registrar 的历史物理原因。用户明确批准同次固定源码 build-only 最多120秒，再进入原运行与清理45秒；这是成功测量边界的扩大，不称旧预算未变或冷启动。必须等待两个真实 compiler-helper close、锁存超时并 drain，拒绝晚成功；同次源码／FD／摘要／nonce绑定交接，真实 FileAttributes 非 reparse 核验在绑定 FD 内，不能借缓存、旧注册产物或 CPU 绿代替真实 Windows。其余门和零重试保持。

同次交接的限额必须在第一次 body read/hash 前检查，不能扫描完再拒绝。新编译 callback 的失败也须等实际 child close，不能把 error/exit 当作 stdio 已关闭。写入自有目标时，Windows 只保证最后写句柄关闭后的时间戳正确；保写 FD 的 inode/dev/mode/nlink/size 和完整摘要，close 后再绑定只读 FD 的时间戳，不能泛忽略文件身份或内容变化。此次原源码 CPU 反例不是历史原生失败原因；依据：[Microsoft File Times](https://learn.microsoft.com/en-us/windows/win32/sysinfo/file-times)。

工作流新增 `node --test` 参数时，也要搜索原命令里的测试路径和 parsed-YAML／整段命令合同；只搜索本次改动的模块文件名会漏掉这些消费者。#755 的首次 Ubuntu 早期 NSIS 步骤实际因精确 cockpit 命令差量未同步而拒绝，未进入原生，不能称 Windows 失败或下载根因。只允许本次精确新增的测试参数，补缺失／重复／替换负控，原历史 pin、lane、环境和失败上传约束保持。

### #723 one bounded phase observation (human-approved cap exception)

The remote first-identity gate may emit optional closed phase buckets on its
existing finite pipe. Runtime stages 1–9 mean entry, prepared-stage complete,
server ready, CPU close, Job started, observer ready, registrar invocation,
first registrar ENTRY, and actual registrar close. Buckets are monotonic elapsed
250 ms intervals (0–180) within the existing runtime; they are coarse observations,
not an extension of its 45 seconds. Registrar checkpoint buckets use their own
process-relative clock; never subtract the two clock domains.

Only the explicit hosted-Windows gate opts into registrar ASCII checkpoints:
ENTRY, root/record, views, binary pin, JSON, flushed files, registry readback,
terminal after disposal. They include no path, ID, PID, hash or error text. At
most 16 lines, 64 bytes per line and 1024 bytes total are consumed; malformed,
truncated, duplicate, out-of-order or failed-sink observations become UNKNOWN.
First abort or actual registrar close freezes the projection. Late output cannot
rewrite it. Default registration, action/identity assertions, actual child-close
joins and cleanup remain authoritative; the fd3 bound stays 4096 bytes.

This is one explicitly approved changed-head remote diagnosis after the three-round
cap, not a fourth behavioral fix. Build remains 120 seconds and runtime plus cleanup
45 seconds, with zero retries. Missing ENTRY or a last checkpoint bounds an unknown
interval; it cannot prove PowerShell startup, a particular Windows API, antivirus,
or the historical failure cause. If this one run is still insufficient, stop UNKNOWN.


## 固定 PowerShell 内置命令的模块绑定（#755）

2026-10-22 的一次获准双 fresh-runner 对照，使用相同闭集 childEnv 与普通 owned 目录：裸 `Get-Item` 停在解析阶段并触及15秒截止；`Microsoft.PowerShell.Management\Get-Item` 在约299毫秒完成解析及内置命令身份核验，读取及目录断言也通过（同进程观测约27毫秒）。run39693953668 的两个模式各只执行一次；这是本次命令发现路径的证据，不证明此前所有Windows超时都由它引起，也不保证全局缓存冷态。

registrar 的六处 `Get-Item` 明确绑定该内置模块，避免为这项固定文件系统检查走裸命令发现。保留每次实际读取、LiteralPath、目录/普通文件及reparse检查、两Registry view所有权和注销前重读；不缓存或删减检查。其余命令未因猜测改写。源码消费者同时核全文件仅六处绑定差异、原业务与registry反例；真正修复仍须精确head原生验收，编译120秒、运行与清理45秒不扩大，单次修复验收若失败即停。

## Node runtime security baseline (2026-10-22)

CI, Windows SEA packaging and native builds use exact Node 22.23.4, including matching official headers and x64 import library. SEA resolves one `node.exe` application path before checking its version and architecture, then reuses that path for all direct Node calls and the executable copy; a bare `node` shim cannot supply a different validated runtime. Development supports `>=22.23.4 <23`; Node 24/26 are not yet qualified. This incorporates the [2026-10-21 security release](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). Older version links above document historical observations, not the current runtime requirement. Do not infer that this update fixes an existing native timeout or identity failure.

安全基线跟踪：[Issue #759](https://github.com/nehcuh/cmspark/issues/759)。

## #723 首个身份验收移出自动 CI（2026-10-22）

用户明确要求移除不稳定的首次身份验收合并条件。仅删除 `run-cockpit-bridge-first.ps1` 自动调用及其专属失败上传；保留脚本、源码/CPU 控制、独立验收的原编译120秒与运行/清理45秒以及全部身份断言。其余 Windows 原生、全量 census、macOS 与构建检查保持。以上旧门禁记录是历史，不表示该调用仍在自动 CI 中。

最新 head `3980ccbc` 的回执是 `CODE_FAILURE`、site48，即 controller 第241行获取 Chrome DevTools 连接地址的 await 拒绝；尚未连接 WebSocket、注册 host 或验证身份。具体底层拒绝原因仍 UNKNOWN，不能沿用此前 TIMEOUT 或 Get-FileHash 归因。移出 CI 是验收范围调整，#723 仍未完成；CI 通过不能作为该功能可用或可发布的证据。
