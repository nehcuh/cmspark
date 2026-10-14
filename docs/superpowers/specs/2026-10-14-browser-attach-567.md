# Browser attach 并发去重

GitHub: #567（已有 bug）。本组件仅收敛 B1：当前隐式活动 tab 的 screenshot / analyze_image 在 TabQueue 后才解析目标，两个入口可能同时进入 ensureAttached，重复 attach 并错误降级。显式目标队列正常，不改目标解析或授权。

每个 BrowserBridge / tabId 保留一条进行中的 attach 序列；同 tab 的调用等到该序列（含既有 best-effort Page.enable）结算，不同 tab 并行。成功与失败均只删除自己所持的 map 条目；失败不缓存，后续可重新尝试。外部 onDetach 仍清 attached 标记，不自动 detach 任何 debugger，不把 already-attached 当作本扩展所有权证明。

保留原10次/500ms tab URL 预检、CDP失败回退、显式 tab 参数要求与禁用活动 tab 回退、Page.enable best-effort、页面原文不可信通道、wait_for deadline/WAIT_PROBE_FAILED、UNKNOWN 健康、权限与 token。无 orphan detect/detach/reattach 或新 ready-state 等待。

先真实 BrowserBridge.execute 隐式截图与混合图像入口红，再同入口绿；补同目标错误共享/成功失败清理/失败后重试、不同 tab 并行、Page.enable 未结算的共享与外部 detach 后重新 attach。成功断言同时核 attach 次数与 fallback 次数，不能以截图 fallback 成功冒充去重。显式 tab 排队、禁止隐式目标、不能拆外部会话作为负向控制。

#567 的 B2 原生 SW 重启孤儿所有权及 B3 导航后执行上下文 settle 仍未验收；旧提交只取意图，不搬回已被 #555/#556 淘汰的 raw last-error 文案。B1 完成不等于整票可关闭。组件 focused / build 后冻结，由独立复审、共享机器与原生 CI 决定是否合入。

## B2：已证明属于本扩展的原生会话复用

2026-10-14 在 main566 专用临时 Chrome for Testing 153 上亲证：本扩展先附着自己的 loopback fixture，精确停止该扩展的 Service Worker 后，新 worker epoch 已变化；新 BrowserBridge 的 Set 为空，attach 拒绝 already-attached，而本扩展的原生 Page.getFrameTree 仍成功。不是用户 DevTools、其它扩展或 attached 布尔值所推断的所有权。

后续原生对照发现，即使 detach API=0，Chrome attach 本身也不能被假定为其它 owner 的无副作用拒绝。因此先查询原生 getTargets 的本 tab 状态：明确未附着才尝试普通 attach；已附着必须调用无页面执行/无业务效果的 Page.getFrameTree，正证本扩展 ownership 才复用。Chrome sendCommand 的客户端查找同时检查目标和调用扩展 ID；只有成功返回有效 root frame ID 才恢复本 Bridge 的 attached 标记。未知 owner、命令失败、空或畸形帧树固定拒绝；目标缺失/查询失败/状态不明确同样拒绝，不能先 attach 去试所有权。没有 detach、重新 attach、存储标志或错误文本本身授予所有权。Page.enable 保持原 best-effort，B1 同 tab in-flight 分享/自己条目清理不变。

getTargets 与后续普通 attach 不是原子操作；Chrome 没有本组件可用的 compare-and-attach API。这个窗口中另一个 debugger 新附着的竞态不能宣称完全关闭。该修复保证已观察到的 foreign/unknown owner 不被主动接管，不能冒称所有情况下完整 owner 隔离；不增加自动重试、token、target、UNKNOWN 分类或时限。

早期另一完整 Bridge 扩展的 negative fixture 只看 attach 计数/请求结果，随后增加独立命令 positive control 后发现该扩展在被测调用前已无法证明 ownership。因此“已挤掉另一扩展”的初步归因已撤回，失败记录保留。最终 native negative 使用专用最小扩展，先证明它自己的 Page.getFrameTree 成功，再证明本扩展命令失败和固定拒绝，最后复验原 owner 命令成功；另外用专用 remote-CDP actor 的恒定读数作前后 control。两者均没有碰用户 DevTools 或其它浏览器。

先保留真实 SW 重启的失败 receipt/退出码，再测实际相同路径通过且 detach=0；增加并发复用、未知/另一扩展 owner/无效帧树/非 already-attached/forbidden URL/外部分离/失败清理控制。原生探针仅自己创建的测试 profile、扩展、fixture tab；全部报告仅结构、计数和时序，不包含像素、页面正文或 credentials。

B3 继续测实际 navigate 的既有加载等待后 CDP selector/context 时序；B2 修复前原生三次正常 selector 成功来自 scripting，不能冒称 CDP settle 已通过。未出现实际反例则不添加 readyState/固定 sleep 或恢复原文 error，也不把 B2 通过等同于原 B3 历史故障已解决。

## 直接调用者的拒绝 envelope

独立复审亲证 `analyze_image` 直接 CDP 路径不会经过 `failInteractive`：新增固定 owner/target 拒绝前缀若原样用作 `error_code`，真实 Companion `classifyError` 会从旧 attach 的 recoverable 变成 non_recoverable，意外终止整个回合。仅在实际 Bridge 异常出口把两条完整固定消息归回既有 `CDP_ATTACH_FAILED` envelope；`data.refusal_code` 为这两个有限 subtype，安全固定原因保留，不暴露 native/page 原文，不归一化未知前缀。拒绝仍为 success=false、attach/detach/evaluate=0，不授权重试、接管或执行；不改变 classifier、site-op 的 freeze/UNKNOWN 规则或授权/预算。

以实际 Bridge.execute 输出跨 JSON 给真实 classifyError 和 site-op 进行 counterfactual 红绿；覆盖 foreign proof 拒绝、查询错误、缺失/歧义目标、畸形 frame proof，以及缺 token/UNKNOWN 不变。实际 interactive caller 的原 CDP_ATTACH_FAILED 应继续冻结该 tab，不能为了 recoverable 回合就消除原禁用或健康计数。该 caller 修复不把 B3 历史缺证据或非原子窗口变成已验收。
