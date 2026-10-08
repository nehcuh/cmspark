# Windows 实机验收（待执行）

此文是可执行检查清单，不是 Windows 已通过的声明。当前只在 Mac/Node 22.23.2 验证。

1. 使用隔离副本和独立 `CMSPARK_DATA_DIR`，不要覆盖生产配置/原 checkout。记录 Windows版本、Node版本、Chrome/Edge版本、companion包版本/文件SHA-256、扩展版本及基线 `3d368a4e`；Chrome/Edge 至少116。生成的新配对密钥只在该测试 profile 手动配对，不写进报告。
2. 在隔离副本安装 lockfile 的依赖后，运行 `cd companion; npm test` 或先 `npx tsc -p tsconfig.test.json`，再 `node scripts/run-tests.mjs .test-dist/tests/local-code-review.test.js .test-dist/tests/local-download.test.js .test-dist/tests/acp-peer-isolation.test.js .test-dist/tests/ws-peer-error.test.js .test-dist/tests/acp-win-spawn.test.js`。扩展 `npm test`。保存完整 exit codes；当前Mac复用KaTeX依赖0.16.47（声明0.18.2）导致一个全量红测，Windows须实际使用声明依赖后重新核验。
3. 分别验证 Node开发版和实际打包exe（包括SEA如发行使用它）。`npm run build:exe` 验证构建/worker解析；实际cmd/npm shim由已有Windows helper处理，但必须实机确认child JSON-RPC握手、UTF-8路径、空格路径、taskkill /T、托盘重启与隐藏窗口行为。用于fixture的ACP命令必须指向真实 `node.exe`，不可拿companion SEA exe当Node解释器。
4. 开启5个并发任务（继承main #579的worker occupancy=5；不要重新提升任务数量限制），另开两个已确认的制品扫描/评审job。观察CPU/内存/事件循环、PID、健康检查、每socket状态、active/queued/job状态。切换后台、停留空闲、打开关闭sidepanel，持续至少10分钟；确认20s应用ping/pong，没有30s空闲回收或重复计时器。server自身30s协议心跳在宿主长阻塞下仍需观测，Mac确定性计时测试不能证明Windows繁忙时不会误判。
5. 在受控测试peer注入未mask RFC6455帧；验收坏peer关闭而另一已配对peer仍能system.ping→pong，companion PID不退出、healthz=200。对本地ACP合成peer分别输出null/数组/错误shape/超1MiB不换行帧，验收仅该ACP session失败，另一peer/companion保持可用。
6. 在测试profile制造连接黑洞/断网/恢复、重复点Reconnect、关闭旧socket后延迟旧消息、service worker停止再唤醒。CONNECTING/认证无响应到下一watchdog检查应恢复（15s阈值、20s检查）；认证OPEN无入站60s阈值后应重建。不配对时不重连风暴。不能把后台job的存续当作chat LLM自动续跑。
7. 合成ZIP含eval候选、假credential、postinstall写marker、README/AGENTS注入、binary、vendor、路径穿越、Windows保留名、大小写重名、symlink、压缩炸弹、坏CRC、hash不符。运行本地scan/fixture ACP；marker不得出现，不导入包、不装依赖、不执行内容，真实私有源码不发送外部服务。将受控HTTPS传输单独做TLS/DNS/redirect集成验收；当前网络测试mock transport，并非实网CDN/企业proxy兼容性证明。
8. pending L2时尝试其他WS答复、model token/thread伪造、修改agent command/env/推理目的地、URL/hash/root/agent替换；必须拒绝或要求新确认。确认台必须滚动显示完整agent目的地和末尾ZIP哈希，不得仅前1200字。运行计划只读run/cancel应拒绝，status/risk_report允许。
9. 握手中取消、评审中取消、120s deadline、下载DNS/stream中取消、排队取消、迟到结果：终态不覆盖、下载/worker终止，ACP child/Windows进程树回收。原chat stop/WS断开后已接受后台job仍可按job_id回收；接受响应丢失后scope内列表可找回。另一chat不得看到job。重启中断job应interrupted且不自动重放，完成结果可恢复。强杀进程后系统temp中源码capsule残留属于当前限制，应核查/清理测试目录。
10. 从网页采集合成统一diff和需求/任务/测试引用，经 `code_review_create → code_review_run → code_review_status → code_review_risk_report` 完整走真实UI。核对输入digest/job_id、ZIP SHA/file/line证据、网页observation/time/url、Agent评语来源、binary/vendor/胶囊外变化遗漏。无命中仍unknown，测试网页声明不可升格已测试；未验证Git身份、业务因果关系与独立评审应保留。

生产启用的具体决策仍未收到：所选ACP命令/agent ID、模型与推理位置、如需外部推理其允许服务和代码范围，以及经核验的禁执行设置。支持明确离线配置或明确外发授权配置，均默认false；本地进程不能证明本地推理。`offline_review` / `review_external_authorized` 是运营者声明，不是OS隔离，协议默认deny不能控制恶意agent自有工具。先用合成代码验证服务配置，不拿真实私有代码试探。

故障记录需区分：companion PID退出/信号；WS close code/reason、auth/heartbeat/reconnect；Chrome service-worker停启；任务cancel/timeout/interrupted；ACP child错误。没有这些Windows现场证据，不能确认用户这次断连由哪条已修复缺陷触发。
