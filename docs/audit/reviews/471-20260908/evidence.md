# #471 · 召唤器与设置重设计证据

Issue: https://github.com/nehcuh/cmspark/issues/471
Base: 4fd4919bee85d34fced4368409a451e9ce4372a8

## 范围与能力声明

T3（呈现与既有信任入口相交）。Surface：扩展设置/Companion HTML 召唤器及备用设置网页。没有新增 L2 类、协议、授权默认值、Agent 执行或自动接受路径；语音/快捷键输入在隐藏时停止捕获。共享 Modal 不改；实验许可覆盖时常规设置内容 inert，关闭后恢复焦点。未发布、打包或替换安装程序；原生 Swift/Windows 视觉验收不在浏览器证据范围。

## 机器证据

- Node 22.23.2，extension production build exit 0；全套 1281/1281，0 fail。
- Companion production build exit 0；主套件 5019 tests / 4996 pass / 23 skip / 0 fail，附加 20/20。最后完整运行在 settings-pointer 与断言更新之后；随后只删除一条死 CSS 媒体规则，以真实 HTML 浏览器测试复核。
- `test-settings-pages-ui.py`：320×480、390×740、800×700、1440×900，8 分类可达且只有1页可见、模型草稿保留、深链焦点、安全状态跨页可见、无隐式 config/许可/terminal 写入；语音取消迟到回调、显式停止原行为、隐藏快捷键录制取消、许可 Tab/ShiftTab/Escape/焦点恢复均通过。
- `test-workspace-ui.py`：既有聊天/导航/确认交互回归通过。
- `test-summoner-workspace-ui.py`：真实 HTML 和脚本，隔离 HTTP/SSE，新对话/历史/文件选择/发送；三个操作顺序、只有一个可见新对话；320×420、390×740、1000×800 无溢出且发送可达。初始及动态空态无 山。
- `test-web-surfaces-ui.py`：真实 HTML 静态 reflow；备用设置网页脚本与基线一致。
- `event-handler-inventory.json`：TypeScript AST 对比基线/最终 SettingsSlideout 所有 JSX on* 属性，原配置和授权处理器保留；移除旧折叠导航处理器，增加分类、焦点记录、助手折叠处理器。此证据不替代布局和生命周期测试。
- 截图均为真实组件/HTML + 合成数据，未接入真实配置；见 screenshots。

## 双路复审

模型：grok-4.6 与 deepseek-v4-pro（Claude CLI 仅传输，不作为 Claude 模型复审）。每轮完整包 gzip 冻结；DeepSeek 只归档最终 result 与模型元数据，不归档内部推理。

- design：首轮拒绝/带 MAJOR，不能放行；公共状态、保存范围、IA 映射和键盘规格补齐。
- design-r2：Grok REVISE；要求许可模态隔离、保存范围、状态文字与按钮拆分、导航样式和隐藏策略。DeepSeek 准予继续但要求明确自主度属于 security。
- implementation：Grok APPROVE_WITH_NITS 但包含 P1/MAJOR，按阻塞处理。DeepSeek APPROVE_WITH_NITS。此轮机器证据曾提前报告全部绿，故仅为临时审计；不作为最终放行依据。
- final：读取精确 implementation 冻结快照重建后的增量、最终完整设计、输入/模态/导航所有者代码、真实绿灯日志和测试，要求同时关闭设计与实现问题；Grok 与 DeepSeek 均 APPROVE_WITH_NITS，无 P0/P1/MAJOR。

### 非阻塞意见处置

- Grok selected-nav 证据缺口：最终增量包省略未修改的 `[aria-current="page"]` CSS；完整源代码和实际计算样式断言另包补审。
- 36px 控件高度、当前页仍显示状态入口、原生 select 同名标签、沿用 h3 层级：接受为本轮一致性选择。
- 重复 CSS 规则、已有配对回调超时反馈、首次即收到许可且无先前焦点时的默认焦点、导出即时偏好与保存文案精细区分：非阻塞后续体验优化，维护者负责；本轮不承诺完整辅助技术合规认证。

## 归责 case

1. 初轮 implementation 包在 Companion 完整测试结束前，提前写“全部绿”。
2. 实际尚有旧装饰标记断言失败；纠正断言后完整套件通过，但旧包不能冒充当时绿灯。
3. AI 过程错误；保留旧包与本说明，最终复审使用新鲜的实际通过结果。
4. 保护评审机器优先、真实证据及禁止自行放行规则。

1. 设置助手折叠后，原语音识别可能继续运行；隐藏页面上的快捷键录制也可能持续截获键盘。
2. 增加 active 生命周期与语音代际守卫，实际浏览器覆盖取消后的迟到回调、显式停止和切页取消录制。
3. 生命周期随新布局改变的实现遗漏；独立审计指出语音问题，后续查验补齐键盘情况。
4. 保护隐藏控件不得执行用户看不到的设置命令。

1. Playwright 测试把 onend 函数赋值作为 evaluate 最后表达式。
2. evaluate 对函数结果自动调用，导致测试提前执行结束回调；加 void 0 后才正确模拟迟到回调。
3. AI 测试夹具错误，非产品取消失效；保留真实失败原因，不能删掉取消断言。
4. 保护测试语料必须真实对应用户交互顺序。

1. 最终补测选中分类背景色时，立即读取 computedStyle。
2. 首次断言读到透明的过渡起点；等待背景动画完成并移开鼠标后，8类桌面选中背景和字重均通过。
3. AI 测试时序错误，非生产 selected 规则缺失；生产 CSS 本轮没有为此改动。
4. 保护视觉验收须区分过渡态、hover 与稳定选中态，不能以片段缺失断言整条样式不存在。

## 最终放行

Final：Grok APPROVE_WITH_NITS、DeepSeek APPROVE_WITH_NITS，无 P0/P1/MAJOR；Closeout：Grok APPROVE、DeepSeek APPROVE_WITH_NITS，均明确关闭 selected-nav 证据问题。精确颜色字面量属于有意钉设计值的测试，不作运行时依赖。机器通过，待 PR 最新提交 CI 通过后方可合并。

评审 Markdown 归档仅去除行尾空白；结论内容不改，冻结输入包与模型结果元数据保留。
