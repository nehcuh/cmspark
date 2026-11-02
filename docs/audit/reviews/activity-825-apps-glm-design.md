# 设计 A 复审（GLM 驱动独立复审）

## 总体结论

独立 agent 的四组受控验证与真实源码逐条核对一致，其设计结论**实质成立**：

- **发现“有时无”的代码路径属实**。`activity-windows.ps1` 的 `Window-Info` 首个 guard（`$h -eq Zero -or -not IsWindowVisible -or IsIconic`）加 `Geometry` 为空即返回 null；Apps 分支只遍历 `EnumWindows`，无 HWND / 最小化 / 隐藏 / 无 geometry 的存活进程没有进入列表的机会。probe 从真实源码导出该 guard 并验证四种输入，结果与源码语义一致。
- **截断与顺序问题属实**。真实 `WindowsPassiveRecorder.listApps`（`platform.ts`）按 `winWindow` 全字段（hwnd/pid/started/geometry/safe）过滤、按 Map 插入序返回、`apps.size < 200` 截断；probe 证明第 201 位的聊天程序被丢弃，且真实 `matchingActivityReply` 拒绝 201 项（`activity-request.ts` 中 `apps.length <= 200`）。**只改 PowerShell 或只改一层都会继续漏**，方案 A 要求 producer/adapter/DTO/wire/matcher 四层同改是必要且正确的。
- **3 秒两层被拒属实**。`validation.ts` 下限 `5_000`；`PersonalWorkspace.tsx` `min={5}`。`service.ts` 的 `pending` 覆盖截图+入库+模型抽取，tick 在 pending 或间隔未到时直接 return，`scan()` 忙时 BUSY。probe 在真实 ActivityService（假时钟、受控挂起模型、仅测试实例投影 3000ms）上证明：3/6/9 秒不新增采集、不积压、释放后只启动一轮不补发——即方案 A 的“最短开始间隔、跳过不排队”语义在现有单路流水线上可直接实现，无需队列框架。
- **轨迹与范围**：不引入 capture/analysis 双队列、不做迁移（`win.<sha256>` 身份格式不变，旧选择仍有效）、不扩权、不激活窗口、不混入设计 B，隐私面无扩大（Apps 的 exe/title 本就不出 companion，wire 仅 app_id/app_name）。三层检查（outcome/trajectory/component）均通过。

证据强度声明：独立测试为 **Darwin CPU 上对真实编译产物的契约验证 + 跨平台消费者证据**，不是 Windows API 执行，也不是五客户端原生验收；未证明用户现场每次缺失的具体成因（最小化/无窗口/路径不可解析/截断各有独立路径）。作为**实施前设计门**这是可接受的，原生验收保留为后续门。

## 逐模块结论与验收条件

| 模块 | 结论 | 外部可观察验收 |
|---|---|---|
| 原生发现与身份 | **APPROVE** | 同一聊天程序：可见→最小化/托盘→无窗口（进程存活）期间，列表始终出现且 `win.<sha256>` 不变；进程退出后从列表消失但已选保留、可取消；路径不可解析/跨会话/敏感进程不出现且无伪造 app_id；Probe 行为零变化（不可采集状态仍拒绝）。列表读取不截图、不改焦点、不还原窗口。 |
| adapter/DTO/wire | **APPROVE** | 无 HWND 行可被新 Apps decoder 接受；4096 边界在 producer/adapter/wire 三处一致；4097 项被截断并带显式截断/不完整标志而非冒充完整或整单失败；确定性排序下两次刷新同序；新增状态字段能通过更新后的 `matchingActivityReply`（闭集键与上限同步放宽，probe 已证旧 matcher 会拒新形态）。 |
| UI 搜索/分页/保留 | **APPROVE** | 搜索过滤先于分页；跨页、刷新、重载后勾选不丢；缺失项显示“当前未发现”并保留最近友好名；标签为“运行进程（含后台程序）”；不出现路径、窗口标题或聊天内容。 |
| 3000ms/慢处理 | **APPROVE** | 后端下限 3000、前端 min=3 同步；2999 拒、3000 收；默认 30000 与已保存用户间隔不被改写；忙时 tick 不新增采集、手动 BUSY；释放后单个 tick 恢复、无补发（probe 已在真实 service 上复现该行为）；UI 文案明示“未完成时跳过，实际间隔可能变长”。 |
| Windows 原生验收门 | **APPROVE（作为必备后续门）** | 见下节；本次不视为已完成。 |

## Blockers

**未发现。** 所有可能阻塞项经核对均已被方案本身覆盖（四层同改、身份与资格分离、单路语义、无扩权）。

## Nits（不阻塞，实施时不可丢）

1. `matchingActivityReply` 对 app 对象是**闭集键校验**（仅 `app_id`/`app_name`）且 `length <= 200`——新增窗口摘要/状态字段若漏改 matcher，所有列表回包都会被判失败（与 probe 证实的 201 项拒绝同构）。
2. 现有 adapter 对 `windows.length > 4096` 是**抛 APP_LIST_FAILED**；引入截断标志后须保证 producer 永不超发 4096，且“截断”走标志而非异常路径，避免不完整状态被误报为失败或反之。
3. adapter 侧 `PROTECTED_APPS` 复检依赖 DTO 中的 `exe` 字段；新 Apps DTO 若去掉 `exe`，敏感排除必须以 producer 侧为准并对 `app_name` 保留复检，防线不得静默丢失。
4. 同一聊天厂商常有多个 exe（launcher/主程序/helper）：显示名（ProductName 优先）+搜索可缓解，但用户可能选到不可采集的身份——UI 已明示“选择≠可采集”，原生验收须确认五款主聊天 exe 可被发现并选中。
5. 友好名保留新增一小块本地持久化（id→名称）：仅存名称，不存路径/标题，与隐私边界一致。

## 必须保留的实施验证

- **CPU/契约**（可控时钟，不用真实 sleep）：旧 guard 拒绝路径、新 Apps decoder 接受无 HWND 行、201/4096/4097 跨 producer-decoder-wire 边界及聊天命中、排序后截断、同 exe 去重与同名不同 exe 区分、已选缺失保持、搜索跨页选择、3000ms 保存重载一致、忙时不并发不补发。
- **Windows 原生**：受控夹具下可见→最小化→托盘/隐藏→无窗口存活→退出全链状态与身份；Probe 在不可采集态继续拒绝；列表读取全程无截图/无焦点切换。
- **五客户端**：微信、企业微信、钉钉、飞书、QQ 记录版本，在同一新构建上核正常运行/最小化托盘发现与选中保留；未安装者保留“未观察”结论，不得以他软件替代。
- 0.8.0 发布前须完成上述原生验收并再次走独立 agent + GLM-Claude 双门；本复审仅为设计 A 放行，不批准发布。

VERDICT: APPROVE_WITH_NITS
