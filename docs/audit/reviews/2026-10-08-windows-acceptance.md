# Windows 实机验收（待执行）

此文是可执行检查清单，不是 Windows 已通过的声明。当前只在 Mac/Node 22.23.2 验证。干净发布分支为 `codex/windows-artifact-review`，接手回归和已跑/未跑边界见 `2026-10-09-stage-validation.md`；旧共享依赖的 KaTeX 红测在独立 lockfile 依赖下已通过。

## 完整 Windows x64 构建命令

前置：已安装 Git、Node 22+ x64、npm，网络可访问 GitHub、npm registry 和
Node 官方下载站。以下连续在 PowerShell 中执行；固定验收实现提交
`b52e4ee4dcc37d56026b5e7b8a0be0bad5fce6c8`。所有任务变量均在使用前定义，
新 checkout 在系统临时目录中，不使用或改写原脏 checkout。

```powershell
$cmsparkValidationRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cmspark-windows-acceptance-" + [Guid]::NewGuid().ToString("N"))
git clone --single-branch --branch codex/windows-artifact-review https://github.com/nehcuh/cmspark.git $cmsparkValidationRoot
if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
Set-Location $cmsparkValidationRoot
git checkout --detach b52e4ee4dcc37d56026b5e7b8a0be0bad5fce6c8
if ($LASTEXITCODE -ne 0) { throw "checkout failed" }
git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw "git revision check failed" }
$cmsparkNodeMajor = node.exe -p "Number(process.versions.node.split('.')[0])"
if ($LASTEXITCODE -ne 0 -or [int]$cmsparkNodeMajor -lt 22) { throw "Node 22+ required" }
$cmsparkNodeTarget = node.exe -p "process.platform + '-' + process.arch"
if ($LASTEXITCODE -ne 0 -or $cmsparkNodeTarget -ne "win32-x64") { throw "Windows x64 Node required for this package" }

Set-Location (Join-Path $cmsparkValidationRoot "companion")
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw "companion npm ci failed" }
npm.cmd run build:exe
if ($LASTEXITCODE -ne 0) { throw "companion JS build/bundle failed" }

Set-Location (Join-Path $cmsparkValidationRoot "chrome-extension")
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw "extension npm ci failed" }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw "extension build failed" }

Set-Location $cmsparkValidationRoot
powershell.exe -NoLogo -NoProfile -File .\scripts\build-windows-exe.ps1 -SkipInstall
if ($LASTEXITCODE -ne 0) { throw "Windows SEA packaging failed" }
Get-Item .\dist-package\cmspark-windows-x64\cmspark-agent.exe
Get-FileHash .\dist-package\cmspark-windows-x64\cmspark-agent.exe -Algorithm SHA256
```

`companion npm run build:exe` 仅编译和 bundle；真正的 SEA exe 来自最后的
`build-windows-exe.ps1` 命令。它要求 ConPTY x64 native sidecar，并校验
打包依赖。若系统执行策略阻止 `.ps1`，保留错误并将 SEA 构建标为 blocked；
本清单不改变执行策略、权限或安全设置，也不将 JS bundle 当作 SEA 成功。

## 独立测试实例启动

继续在同一 PowerShell 会话、仓库根目录执行下面配置段，先检查 23401 未占用。
它只初始化新测试目录；ACP、MCP 和内嵌终端初始关闭，LLM 指向不可用的
loopback fixture，不连接生产推理服务。不要复制生产配置或配对密钥。

```powershell
$cmsparkValidationData = $cmsparkValidationRoot + "-data"
$env:CMSPARK_DATA_DIR = $cmsparkValidationData
$cmsparkValidationPort = 23401
$cmsparkPortProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $cmsparkValidationPort)
try { $cmsparkPortProbe.Start() } catch { throw "Port 23401 occupied; use an idle test machine/window without stopping production" } finally { $cmsparkPortProbe.Stop() }
node.exe -e "const c=require('./companion/dist/config.js');c.initDataDir().then(()=>{c.saveConfig({port:Number(process.argv[1]),llm:{api_key:'',base_url:'http://127.0.0.1:1/v1',model_name:'fixture'},acp:{enabled:false},mcp:{enabled:false},embedded_terminal:{enabled:false}});console.log('Test configuration initialized')}).catch(e=>{console.error(e);process.exitCode=1})" $cmsparkValidationPort
if ($LASTEXITCODE -ne 0) { throw "test configuration failed" }
Write-Host "Test data: $cmsparkValidationData"
Write-Host "Companion port: $cmsparkValidationPort"
node.exe .\companion\dist\index.js start
```

最后一条为前台 Node 版服务；Ctrl-C 显式结束后，可在同一会话改用
`& .\dist-package\cmspark-windows-x64\cmspark-agent.exe start` 验证 SEA。
不要同时启动两个实例；扩展当前固定连接 `ws://127.0.0.1:23401`，没有自定义
端口设置。若端口已占用或在探测后被占用，将实例启动记为 blocked，并在空闲
测试机器/时间窗口重试；不停止生产服务、不改端口设置。使用独立 Chrome/Edge
profile，加载本 checkout 的 `chrome-extension/build/chrome-mv3-prod`，在
「设置 → 连接与配对 → WS 配对密钥」手动配对该测试实例，再按第 11、12 项验收终端。合成 ACP
fixture 的进程回归使用第 2 项的隔离测试 runner，不启用生产 ACP agent。

## 逐项验收

1. 使用隔离副本和独立 `CMSPARK_DATA_DIR`，不要覆盖生产配置/原 checkout。记录 Windows版本、Node版本、Chrome/Edge版本、companion包版本/文件SHA-256、扩展版本及基线 `3d368a4e`；Chrome/Edge 至少116。生成的新配对密钥只在该测试 profile 手动配对，不写进报告。
2. 在隔离副本安装 lockfile 的依赖后，运行 `cd companion; npm test` 或先 `npx tsc -p tsconfig.test.json`，再 `node scripts/run-tests.mjs .test-dist/tests/local-code-review.test.js .test-dist/tests/local-download.test.js .test-dist/tests/acp-peer-isolation.test.js .test-dist/tests/ws-peer-error.test.js .test-dist/tests/acp-win-spawn.test.js`。扩展 `npm test`。保存完整 exit codes；旧任务共享 KaTeX 0.16.47 曾导致红测，接手使用声明/lockfile 的 0.18.2 后扩展全量 1515/1515 通过。Windows仍须实际重新运行，不能继承Mac通过结论。
3. 分别验证 Node开发版和实际打包exe（包括SEA如发行使用它）。`npm run build:exe` 验证构建/worker解析；实际cmd/npm shim由已有Windows helper处理，但必须实机确认child JSON-RPC握手、UTF-8路径、空格路径、taskkill /T、托盘重启与隐藏窗口行为。用于fixture的ACP命令必须指向真实 `node.exe`，不可拿companion SEA exe当Node解释器。
4. 开启5个并发任务（继承main #579的worker occupancy=5；不要重新提升任务数量限制），另开两个已确认的制品扫描/评审job。观察CPU/内存/事件循环、PID、健康检查、每socket状态、active/queued/job状态。切换后台、停留空闲、打开关闭sidepanel，持续至少10分钟；确认20s应用ping/pong，没有30s空闲回收或重复计时器。server自身30s协议心跳在宿主长阻塞下仍需观测，Mac确定性计时测试不能证明Windows繁忙时不会误判。
5. 在受控测试peer注入未mask RFC6455帧；验收坏peer关闭而另一已配对peer仍能system.ping→pong，companion PID不退出、healthz=200。对本地ACP合成peer分别输出null/数组/错误shape/超1MiB不换行帧，验收仅该ACP session失败，另一peer/companion保持可用。
6. 在测试profile制造连接黑洞/断网/恢复、重复点Reconnect、关闭旧socket后延迟旧消息、service worker停止再唤醒。CONNECTING/认证无响应到下一watchdog检查应恢复（15s阈值、20s检查）；认证OPEN无入站60s阈值后应重建。不配对时不重连风暴。不能把后台job的存续当作chat LLM自动续跑。
7. 合成ZIP含eval候选、假credential、postinstall写marker、README/AGENTS注入、binary、vendor、路径穿越、Windows保留名、大小写重名、symlink、压缩炸弹、坏CRC、hash不符。运行本地scan/fixture ACP；marker不得出现，不导入包、不装依赖、不执行内容，真实私有源码不发送外部服务。将受控HTTPS传输单独做TLS/DNS/redirect集成验收；当前网络测试mock transport，并非实网CDN/企业proxy兼容性证明。
8. pending L2时尝试其他WS答复、model token/thread伪造、修改agent command/env/推理目的地、URL/hash/root/agent替换；必须拒绝或要求新确认。确认台必须滚动显示完整agent目的地和末尾ZIP哈希，不得仅前1200字。运行计划只读run/cancel应拒绝，status/risk_report允许。
9. 握手中取消、评审中取消、120s deadline、下载DNS/stream中取消、排队取消、迟到结果：终态不覆盖、下载/worker终止，ACP child/Windows进程树回收。原chat stop/WS断开后已接受后台job仍可按job_id回收；接受响应丢失后scope内列表可找回。另一chat不得看到job。重启中断job应interrupted且不自动重放，完成结果可恢复。强杀进程后系统temp中源码capsule残留属于当前限制，应核查/清理测试目录。
10. 从网页采集合成统一diff和需求/任务/测试引用，经 `code_review_create → code_review_run → code_review_status → code_review_risk_report` 完整走真实UI。核对输入digest/job_id、ZIP SHA/file/line证据、网页observation/time/url、Agent评语来源、binary/vendor/胶囊外变化遗漏。无命中仍unknown，测试网页声明不可升格已测试；未验证Git身份、业务因果关系与独立评审应保留。
11. 验证新增 Windows 内嵌终端：扩展「设置 → 本机与工具 → 内嵌终端（实验 · 默认关 · macOS / Windows）」开启后，点击「打开内嵌终端」，回到侧栏批准 L2。拒绝时不得有 PTY PID；批准后应为绝对路径 PowerShell `-NoLogo -NoProfile` / ConPTY。输入合成中文/emoji、缩放窗口、查看 `$Host.UI.RawUI.WindowSize`，核对实际输出及 resize；不启动真实 agent。现有限制为同时一个内嵌 PTY，仍可与五个 companion 任务并发。
12. 仅断开扩展 WS 或停止/唤醒 MV3 worker（不要重启 companion），在 30 秒内恢复：UI 显示恢复中并暂停输入，恢复后 PID 不变，未 ACK 输出回放且 UI 不重复显示，断线期间命令/粘贴不得重放；relay 与 page 同时 attach 不得结束 PTY。旧 peer 输入/关闭无权影响新 owner。超过 30 秒应回收进程、拒绝旧 token，重开仍需新 L2。关闭终端页/点击关闭应回收 PowerShell 和其受控子进程树。分别对 Node 开发版与实际 SEA exe 验证 native sidecar 的 staging/解析；缺 `@lydell/node-pty-win32-x64` 打包必须失败。

生产启用的具体决策仍未收到：所选ACP命令/agent ID、模型与推理位置、如需外部推理其允许服务和代码范围，以及经核验的禁执行设置。支持明确离线配置或明确外发授权配置，均默认false；本地进程不能证明本地推理。`offline_review` / `review_external_authorized` 是运营者声明，不是OS隔离，协议默认deny不能控制恶意agent自有工具。先用合成代码验证服务配置，不拿真实私有代码试探。

故障记录需区分：companion PID退出/信号；WS close code/reason、auth/heartbeat/reconnect；Chrome service-worker停启；任务cancel/timeout/interrupted；ACP child错误。没有这些Windows现场证据，不能确认用户这次断连由哪条已修复缺陷触发。
