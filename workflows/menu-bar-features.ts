// Workflow: 实现菜单栏空位功能
// 实现托盘右键菜单中的设置和快速操作功能

export const meta = {
  name: "menu-bar-features",
  description: "实现菜单栏所有空位功能：设置、截图、读取页面、提取数据、总结",
  phases: [
    { title: "Settings", detail: "实现 LLM 设置功能（交互式 CLI + 菜单栏入口）" },
    { title: "Quick Actions", detail: "实现快速操作（截图、读取、提取、总结、新建对话）" },
    { title: "Adversarial Review", detail: "安全审查 + UX 审查" },
    { title: "Integration", detail: "回归测试、编译验证、文档更新" },
  ],
}

// Phase 1: Settings
phase("Settings")

log("Phase 1: 实现 LLM 设置功能")

// Agent A: message-router.ts — 添加 settings.get / settings.set / settings.test
const routerResult = await agent(`
在 companion/src/message-router.ts 中：
1. 让 "config.test" 和 "settings.test" 共用同一处理逻辑
2. 新增 "settings.get" — 返回脱敏的 LLM 配置（api_key 显示为 ***）
3. 新增 "settings.set" — 接收 settings 对象，校验 temperature/context_window/base_url，保存到 config.json
4. 添加原型污染检查（hasPrototypePollutionKey）到 settings.set
`, { label: "router:settings", phase: "Settings" })

// Agent B: menu-bar-agent.ts — 替换 settings TODO
const menuBarResult = await agent(`
在 companion/src/menu-bar-agent.ts 中：
1. 替换 "settings" case 的 TODO（safeNotify("设置功能开发中")）
2. 新增 openSettingsUI() 函数：使用 osascript 打开 Terminal.app 运行交互式设置 CLI
3. 保留 fallback：osascript 失败时直接运行 settings CLI
`, { label: "menu-bar:settings", phase: "Settings" })

// Agent C: settings-cli.ts — 创建交互式设置模块
const cliResult = await agent(`
创建 companion/src/settings-cli.ts：
1. runInteractiveSettings() — readline 交互式修改 LLM 配置
2. runNonInteractiveSettings(kvPairs) — --set key=value 非交互模式
3. 输入校验：api_key 长度和 sk- 前缀、base_url URL 格式、temperature 0-2、context_window 1000-10000000
4. 脱敏显示 API key（maskApiKey）
`, { label: "settings-cli", phase: "Settings" })

// Agent D: index.ts — 集成 settings 命令
const indexResult = await agent(`
在 companion/src/index.ts 中：
1. 导入 runInteractiveSettings / runNonInteractiveSettings
2. 在 printUsage() 添加 settings 命令说明
3. 在 main() 添加 "settings" case 处理
`, { label: "index:settings", phase: "Settings" })

// Phase 2: Quick Actions
phase("Quick Actions")

log("Phase 2: 实现快速操作")

// Agent A: message-router.ts — 完善 executeQuickAction
const qaRouterResult = await agent(`
在 companion/src/message-router.ts 的 executeQuickAction handler 中：
1. read-page — 调用 get_page_text，截取前500字符作为 message 返回
2. extract-data — 调用 get_page_text(selector)，截取前500字符返回
3. screenshot — 调用 take_screenshot，返回 imageData
4. summarize — 先 get_page_text 获取内容（slice(0,8000)限制），再调用 OpenAI API 生成一句话总结（max_tokens=256）
5. new-chat — 创建线程，返回 thread_id 和消息
6. 所有操作返回 { type: "quickAction.result", id, success, message/error }
`, { label: "router:quickaction", phase: "Quick Actions" })

// Agent B: companion-client.ts — 返回结果
const clientResult = await agent(`
在 companion/src/tray/companion-client.ts 中：
1. 修改 executeQuickAction(id) 返回 Promise<any>（原返回 void）
2. 将响应结果返回给调用方（而不是仅打印 debug）
3. 错误时返回 { success: false, error }
`, { label: "client:quickaction", phase: "Quick Actions" })

// Agent C: menu-bar-agent.ts — 处理结果展示
const menuBarQaResult = await agent(`
在 companion/src/menu-bar-agent.ts 中：
1. 修改 quick-action case：调用新的 handleQuickAction(id) 异步函数
2. handleQuickAction：
   - 先发送"正在执行"状态通知
   - 根据 action 类型处理结果：
     * screenshot：saveScreenshot(imageData) 保存为 PNG（0o600权限），然后 open 打开
     * read-page/extract-data：safeNotify 展示前200字符摘要
     * summarize：safeNotify 展示总结内容（前300字符）
     * new-chat：展示创建成功消息
   - 失败时展示错误通知
3. saveScreenshot：从 result.imageData 提取 base64，保存到 ~/.cmspark-agent/cache/
`, { label: "menu-bar:quickaction", phase: "Quick Actions" })

// Phase 3: Adversarial Review
phase("Adversarial Review")

log("Phase 3: 对抗式验证")

// Security Reviewer
const securityReview = await agent(`
审查以下安全点，返回 { issues: string[] }：
1. settings.set 是否有输入校验？temperature 范围、context_window 范围、base_url URL 格式
2. API key 是否始终脱敏？settings.get / config.get 返回 ***，settings.set 过滤 ***
3. settings.set 是否有原型污染检查？
4. screenshot 临时文件是否安全？保存位置、文件权限、命名方式
5. quickaction.execute 是否有权限隔离？是否只读操作？
6. summarize 的 LLM 输入是否限制长度？pageText.slice(0,8000)
`, { label: "security-review", phase: "Adversarial Review", schema: {
  type: "object",
  properties: {
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["issues"],
} })

if (securityReview.issues.length > 0) {
  log(`Security issues found: ${securityReview.issues.join(", ")}`)
} else {
  log("Security review passed")
}

// UX Reviewer
const uxReview = await agent(`
审查以下 UX 点，返回 { issues: string[] }：
1. 设置修改后是否需要重启 Companion？（saveConfig 更新 cachedConfig，chat.create 实时读取，不需要重启）
2. 快速操作失败时是否有友好的错误提示？
3. 是否有执行状态反馈（"正在执行..."通知）？
4. 设置 CLI 的交互是否清晰？是否有当前值显示？
5. 截图保存后是否自动打开？
`, { label: "ux-review", phase: "Adversarial Review", schema: {
  type: "object",
  properties: {
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["issues"],
} })

if (uxReview.issues.length > 0) {
  log(`UX issues found: ${uxReview.issues.join(", ")}`)
} else {
  log("UX review passed")
}

// Phase 4: Integration
phase("Integration")

log("Phase 4: 回归测试与集成")

// Build verification
const buildResult = await agent(`
运行 cd companion && npm run build 验证 TypeScript 编译通过。
返回 { success: boolean, errors: string[] }
`, { label: "build-verify", phase: "Integration", schema: {
  type: "object",
  properties: {
    success: { type: "boolean" },
    errors: { type: "array", items: { type: "string" } },
  },
  required: ["success", "errors"],
} })

if (!buildResult.success) {
  log(`Build failed: ${buildResult.errors.join("\n")}`)
} else {
  log("Build passed")
}

// README update
const readmeResult = await agent(`
在 README.md 中更新：
1. 在"特性"部分添加菜单栏快速操作说明
2. 在"跨平台通用命令"部分添加 settings 命令
返回 { updated: boolean }
`, { label: "readme-update", phase: "Integration", schema: {
  type: "object",
  properties: {
    updated: { type: "boolean" },
  },
  required: ["updated"],
} })

log("Menu bar features workflow completed")

return {
  settings: { router: !!routerResult, menuBar: !!menuBarResult, cli: !!cliResult, index: !!indexResult },
  quickActions: { router: !!qaRouterResult, client: !!clientResult, menuBar: !!menuBarQaResult },
  review: { security: securityReview.issues, ux: uxReview.issues },
  integration: { build: buildResult.success, readme: readmeResult.updated },
}
