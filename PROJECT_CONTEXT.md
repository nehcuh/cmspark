# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-06-08 (15:12)
- 重设计应用图标：瑞克和莫蒂传送门风格（亮绿色漩涡传送门，扩大 30%）
- 新增 macOS .dmg 安装包流程：.app bundle + 拖拽安装 + Applications 链接
- 修复三个打包问题：(1) DMG 缺少 Applications 入口 (2) Intel 芯片警告 (3) .app 启动无反应（路径解析）
- 修改文件：generate-icons.mjs（新传送门渲染器）、create-dmg.sh（新建）、paths.ts（.app 路径兼容）、package.sh（强制下载官方 node）
- 下一步：用户测试 DMG 安装 + Chrome 扩展图标效果
### 2026-06-06 (16:45)
- 补齐 companion/src 测试覆盖：5 个模块 (bridge, history, server, skills, single-files)
- 三保险修复 bridge/ 模块：9 个 agent 参与 3 层修复流程
- 提交 2 个 PR：d356590 (test coverage), 8d48711 (bridge fixes)
<!-- handoff:end -->
