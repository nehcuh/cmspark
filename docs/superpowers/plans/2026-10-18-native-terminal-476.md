# #476 终端 / 接力实施计划候选 R1

只供合同审批。必须 两位真正互盲非作者合同 reviewer 批准后才实际编码；当前workspace34仍pending，不动其冻结源。作者随后source审批也必须两个真实非作者，不能用本轮source-gap producer代替。

## A. 先固定旧行为与失败

从最终认可的title/workspace公共树建立独立owned候选；保主分支及所有dirty/untracked不动。逐blob核PTY/ACP旧方法、globalgate、单handbacksink和旧UI资产；记录currentmethodset而非猜数。HMAC用actualchannel证明新11方法原拒绝；本包实际handler desktop拒绝可以复用，但新增wire仍须真实旧callback RED。完整旧PTY/ACP与CodeReview相关测试保基准，不重造backend。

## B. 私有 actor 与两个窄 runtime 入口

1. channel/capabilities/readDTO增加11个精确方法，safeThread/ids/strictschemas/flatframe预算。新local-work actor连接当前native owner、document、canonical ThreadManager和显式workspace snapshot；状态不能启动shell或Agent（既有固定discovery utility须如实计数）、启module或创建目录。freshrevision与thread/root/OCC同步复核复用workspace边界，不复用renderer提交path。
2. `pty/handler.ts`的panelonly保持；把共用的open确认后验证/真实spawn生命周期抽窄成受信任server runtime接口，或从session现接口调用同一共享验证闭包。禁止复制一个弱化open实现。原nodepty/session/env/tree-kill/closing/backpressure仍唯一实现。nativeowner与legacyWS区分，测试wrongowner两边都不能互控。
3. ACP manager新增per-proposal私有start disposition（native固定不启动ModeC）与per-session confirmation/current/abort callback，默认legacy不变。新nativeactor内部指定review_readonly、serveragent snapshot，复用propose/start；permission请求失ownerdeny而不借globalgate。globallegacygate与singlehandbackSink保原功能。
4. lifecycle原addMessage成功后提供小型订阅/receipt出口，native投影不能增加第二次持久化。仅新增nativeoperation固定幂等message id映射；save失败/重复callback/lostACK实际控制。terminal.return显式用户摘录原生确认并独立稳定ID，原review.submit结构化路径完整保留。

## C. 信任根 / UI真实纵向

同步native C++/Swift、windows-bootstrap、launcher、builder、admission grammar与所有源合同/acceptance fixtures；只新增批准method/purpose/kind，不扩大通用能力。controller改写ID映射要携带原operation/document，退役顺序先cancel再清；旧epoch返回不得投新doc。读方法/renderer/native表展开计数机械一致，remint旧capability。

现local-work页就地提供终端与Agent两区即可，不要求新框架或新窗口。复用已锁xterm+fit的公共核心/样式，独立native transport适配，固定本地资源映射与package验证；不要copyChrome.runtime.Port。不注册自动打开链接/OS剪贴板等额外escape回调，TTY控制序列不获得新原生能力。真实键盘输入、resize、停止、状态、无agent/moduleoff提示、当前thread与输出来源可见；Agent启动由真实native确认，不能renderer自报usergesture/cloudaccepted。UI只显示安全AgentDTO和已redacted canonical消息。

## D. 受影响永久控制（实际调用，不镜像实现）

- actualHMAC/channel→actor→ThreadManager/PTY/ACP seam→DOM；真实RT input/ACK/backpressure/resize/close调用计数，输入重复seq/错base64/错owner0effect。
- 正常/无agent/moduleoff、explicitroot/unbound、readonly/worker、busy/unknown、rootreplace/OCC/确认前后配置变更、默认shell与Agent命令snapshot、spawnboundarycancel、Windows准备异步中撤权。
- nativeAgentpermission与legacygate互不串，native不消费legacyembedintent、不生成ModeC第二进程。原legacy双进程行为原义保留。
- 当前doc A→B→A、pending确认→切页、host撤权、close/exit、lateevent/ack、disconnect/noresponse、相同thread新owner；kill只有拥有的child/PTY，closing未收敛不可再open。
- 原handbacksink实际commit失败/重复通知/lostACK/reload；只有确认内容进原canonicalthread且只一条。terminal摘录与结构化review区分，secretmarkers/路径/命令/env不进safeDTO或证据包。
- 固定assets/offline加载、methodtable所有消费者与builder source闭包；尽量复用unchanged旧测试，不能为regex过期而弱化sequence。

测试执行只cleanallowlist env+预importeffectguard、ownedFS/Node/TS；运行时credential只原受信任process内部，不输出/拷贝/哈希。根与作者都有代码时最终两reviewer均须非作者；唯一affectedARM合并做，不每个按钮各建容器/评审轮。

## E. 发布前硬验收

freeze完整diff/current源码、前后Git身份、outsideexact、sourceclosure、旧RED及纠正、真实count/rawhash/report；两source reviews+affectedARM后才由root决定publish新head。hostedWinMac新增独立owned真实PTY与Agent协议fixture，保normalnativecase/45s/原超时/预算；真实OSspawn、可信确认、Unicode、input+resize+stop、cancel与currentthread持久重开都要实际收据。Absentagent是通过明确拒绝验收，不要求安装登录商业Agent，也不把fixtureownedCLI称真实vendor账户验证。

head/main全4实际门禁由root处理；失败不unchangedrerun、不扩timeout、不默认启用、不改L2/noop假通过。#476仍partial，PTY/接力完成不自动关Chrome可见性等剩余DoD。


<!-- Approved narrow fixed-asset compatibility correction, 2026-10-18. -->
固定 xterm 6.0.0/addon-fit 0.11.0 使用原 extension 已锁版本/完整性，原生包离线复制，不安装或改变模块默认值。实际源码证明 Document override 不能覆盖全部动态 style 创建；仅对已锁原 bundle SHA/版本和恰四个 style 工厂表达式进行可逆拷贝变换，原 receiver/调用次数/返回 element 不变，只设置该 HTML 文档随机 style nonce；全局 document 不改。原 vendor LICENSE 随固定资产保留。两 host 对每次允许的固定主文档导航生成随机 64hex，仅在原固定 HTML 的 CSP/meta 两个唯一占位进行内存替换，坏占位拒绝。只增加 style-src-elem 的该 nonce，原 script/connect/导航/来源限制不扩大；不是身份、grant 或业务消息字段，不持久化或输出。相同 HTML 内的 WS 重连只换原业务 generation，不伪称重载/换 CSP；真正显示仍须 hosted Windows/macOS 验收。
