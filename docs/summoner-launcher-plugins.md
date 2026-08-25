# 召唤器 · 外部快捷键分发（Wave 2）

CMspark **不重做** Raycast / uTools。推荐把它们当 **快捷键分发面**：唤起本机召唤器，而不是在启动器里复制 Side Panel。

## macOS · Raycast

1. CMspark 菜单栏已注册召唤器热键（设置里可改）。Raycast 也可绑同一组合。
2. 或用 Script Command 打开召唤器页面（Companion 已在跑时）：

```bash
#!/bin/bash
# Required: companion 已启动。实际 URL 带一次性 token，由托盘「召唤器」菜单打开。
# Raycast 里绑定「打开 CMspark 召唤器」= 触发系统热键，不要自己拼 token URL。
osascript -e 'tell application "System Events" to keystroke " " using {command down, option down}'
```

把热键改成你在 CMspark 里配置的组合。**不要**在 Raycast 插件里保存 `ws_secret` 或 loopback token。

## Windows · uTools

同理：uTools 全局快捷键映射到 CMspark 召唤器热键。不要在插件里实现 MCP/知识管理。

## 禁止

- 在启动器插件里做确认/Allow/Deny
- 把知识导入、Skill CRUD、MCP 表单塞进 Raycast/uTools
- 把 CMspark 营销成「Raycast 替代」
