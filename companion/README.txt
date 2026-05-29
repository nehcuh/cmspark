CMspark Browser Agent v0.1.0
===============================

浏览器 AI 助手 — 让 AI 帮你操作网页

## 安装

1. 双击 install.bat
2. 在 Chrome 中加载扩展（按屏幕提示操作）
3. 完成！

## 使用

1. 打开任意网页
2. 点击 Chrome 右侧工具栏的 CMspark 图标（拼图 → CMspark）
3. 在侧边栏输入任务，如"读取这个页面内容"、"点击登录按钮"

## 配置 LLM

默认使用 DeepSeek。如需更改：

1. 在 CMspark 侧边栏点击设置（齿轮图标）
2. 填入你的 API Key
3. 或设置环境变量: set DEEPSEEK_API_KEY=sk-xxx

## 卸载

1. 双击 uninstall.bat
2. 在 Chrome 中移除扩展

## 数据位置

所有数据存储在: %USERPROFILE%\.cmspark-agent\
- skills/  技能文件
- history.db  操作历史
- logs/  运行日志

## 常见问题

Q: Side Panel 显示"未连接到 Companion"
A: Companion 进程未启动。双击 cmspark-agent.exe 手动启动

Q: 端口 23401 被占用
A: 打开任务管理器，结束 cmspark-agent.exe 进程后重试

Q: 如何更新？
A: 下载新版本 zip，解压覆盖所有文件，重启 CMspark 即可
