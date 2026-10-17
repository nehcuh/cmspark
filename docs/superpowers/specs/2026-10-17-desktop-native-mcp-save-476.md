# 原生确认与 MCP 保存首组合同候选
GitHub: #476。状态：DRAFT，待 root 非作者批准，未获实施授权。
基线 main9caa176c03ea3f0fe0ac778e292f0d979f04775f/tree5862c009；细化既有 desktop-workbench 第3、4节，不新增 Issue/通用服务。

## 可用结果和范围
用户在独立工作台 MCP 页新建或编辑一个 stdio 配置→点保存→OS 原生确认窗显示准确动作→批准后真实原子保存并回显持久化结果；拒绝/取消/失败保留草稿。不能只交无用户入口的确认接口。
首组支持 add/update，姓名更新不等于重命名：既有 name 固定；字段 command、args（逐项字符串）、cwd、enabled。新建 trust_level=manual；更新保持既有 trust_level、env、roots、security_capabilities、超时/restart 等未开放字段原值。stdio 以外条目仍可看状态，但编辑明确“不在首组”；HTTP、删除、显式连接/断开、终端/技能/知识不开放。保存 enabled 配置可能由现有 applyConfig 自动启动/重启进程，原生确认必须明确展示，不能宣称纯写文件或借排除 connect 隐藏此副作用。真实运行仍经原有 transport/权限约束。

## 身份与消息兼容
旧六个读方法和旧 extension/tray/summoner ACL 原义不变。新增受限 desktop.mcp.edit、desktop.mcp.save；仅 native-controller 可发 desktop.confirmation.decision。独立生成 renderer 方法集与 native-only 方法集，不能把 decision 放进原六读表或渲染器表。
method-set 从1到2，由可信 launcher 撤销旧 capability、用新 hash-gated 双平台 host 重铸；auth 协议仍1，不改 HMAC 域/nonce/匿名 bootstrap/Origin。旧v1不能运行时升级，也不回退 tray 权限。既有读取 host/测试应以生成版本校准，旧协议拒绝/重放/重连负控保留。
现有 daemon/Swift/CPP flat-frame 规则保留：save 外层仅 type/id/thread_id/action/name/payload_json（以及桥内现有 generation），action 只 add/update，payload_json 只含上述固定可编辑字段。双层拒未知/重复（含转义重复）/prototype 键、错型；不借字符串槽开放任意方法/配置补丁。复用原 WS payload cap，未新增任意数值或放宽 parser。edit 返回单目标编辑 DTO，仅本机 owner 表单使用；env/headers 原值不下发、原六读 DTO 不扩大。

## 一次确认与精确动作
复用 server 单例 manager 和原45s timeout、现有 L2 admission caps/等待纪律，finally 释放；每连接已有保存忙态时拒第二次提交，不造第二队列/延长期限。manager.pending 本身没有总数 cap，不能虚称已有该上限。
服务端先严格校验并按原规则合并成完整 normalized mutation：name/action、server全部最终值、首次添加导致全局 enable 的既有副作用，持有私有深拷贝；command/argv/cwd 不以展示拼接串替代真实值，保留精确字符串。绑定不可伪造 principal、确切socket/connection、精确线程上下文、confirmation_id、原截止期、完整私有 mutation 与 action digest。MCP为全局设置：无会话时 thread_id=null 绑定本次settings上下文，绝非通配符；带thread_id则验证真实线程，之后不可转借。这样空安装也可首次配置，不增thread.create。root已明确接受null精确settings绑定候选，整体合同仍待批准。原生回执只携已捕获 confirmation_id/thread/digest/approve-or-deny；不接受 renderer 提供“已确认”、新 payload 或 trust/whitelist extras。
现 handler 仅对 stdio spawn-surface 变更请求确认；此桌面保存必须每次确认且恰好一次。允许必要私有 session/提交 hook 将已规范化动作交同一 manager，legacy 不变；不得外层先批再让 handler 二次弹窗，也不得公开 skip-confirm flag、使用 tray privileged respond() 或单凭同connection批准。
原生 controller 在 NSAlert/TaskDialog 等隔离 OS 控件呈现 server 生成的 escaped 关键动作；提供原生只读滚动“查看完整动作”，明确 argv 项边界、cwd、启用/启动副作用。现 code_preview1200 仅预览，不是授权 payload，也不能丢尾部。完整 payload/digest 仅 daemon/native 内存；敏感 env 值默认隐藏，owner 明确查看才在原生控件中显示，不进 WebView/聊天/LLM/日志。owner 输入的 command/args/cwd 只在该表单与原生窗口流动，不送 provider；MCP 响应继续脱敏。

## 取消、提交与结果
复用现 onDisconnect→rejectAll(ws)、AbortSignal、onTerminal；先删除 pending，再通知关闭对应原生控件。socket断线/重新认证、host退出/撤销、线程或动作失效、文档既有 generation 替换都使旧请求不可提交；原生代际变化只复用现字段，不新增全局 generation 框架。原生回调捕获原 connection/document/action 上下文，不从 DOM 取 decision。重复/迟到/旧 web ID/错owner或thread/digest拒绝，不能消耗别人的 pending。approve 与同turn abort仍须在提交前拒绝。
现 handler 在 await 前取 config、确认后拼旧 servers map，不能原样接入：新路径订阅既有 CONFIG_CHANGE_EVENT，对目标及global-enabled新增/删除/修改形成不可逆 stale latch（包括改回原值的 ABA，仅限已有configEvents可观察变化，不声称观察所有外部文件ABA）；通常无关 sibling 变化不误拒、不得被旧快照覆盖；若本动作会按原first-add语义启用全局MCP，则空表与global-enabled也是已呈现的相关前提，等待期间新添sibling必须stale，避免连带启动未经该动作展示的服务。每个 await 后重核 owner/signal/线程/目标基线。最后同步区从当前 map 合并恰好一个冻结目标，通过原atomic writer一次写入servers与该动作的enabled结果（允许给replaceMcpServers加仅内部可用的有限enabled选项，旧caller原义不变）；现add先replace再setEnabled的两写不可冒全事务原子性；最后校验到同步写入间无 await。不得顺便改其它 config 或引入持久 grant。
只在原子持久化成功后给保存 ACK；再取当前 masked 状态回显。连接稍后失败须如实显示“已保存/连接失败”，不把它当未保存或强连成功；落盘异常无成功 ACK、草稿保留。请求/错误日志不得包含 config、argv、env、原生全文或 action digest。

## 完成标准
下方 plan 的真实 producer/manager/store 红绿与全部取消负控、双平台 native 确认桥和原六读兼容门通过；独立非作者及原票要求 Grok4.6+DeepSeekV4Pro、必要 Kimi/配置 Claude、精确新 head/main CI。软件自动点击只作桥验证，不冒真人 Hello/生物识别。不因此关闭 whole #476。
