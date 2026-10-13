CMspark Browser Agent v0.6.11
===============================

浏览器 AI 助手 — 让 AI 帮你操作网页

## 安装

官方路径（Windows）：

1. 运行安装向导 CMspark-Setup-v0.6.11.exe（NSIS），或解压 cmspark-v0.6.11-windows-x64.zip
2. 官方 zip / Setup 入口是包内的 node.exe + cmspark-agent.js（不是 cmspark-agent.exe SEA 单文件）
3. 在 Chrome 中加载扩展（按屏幕提示 / 安装器说明）
4. 完成！

便携 zip 也可双击 install.bat / launch.bat。若目录里还有 cmspark-agent.exe，那是可选本机 SEA 形态，不是 GitHub Release 默认。

## 使用

Office 文件导入：支持 DOC/DOCX、XLS/XLSX、PPT/PPTX、ODT/ODS/ODP。
旧版 DOC/XLS/PPT 和 ODP 使用随包分发的 DeepSeek LibreOffice Kit 0.1.5
进行本地转换后读取；PDF 的低文本页面也可使用此引擎渲染供视觉分析。
WPS 保存的标准 DOCX/XLSX/PPTX 可读取；专有 WPS/ET/DPS 请先另存为标准格式。
ODF 导入限制重复正文和图表数据的展开量；超预算、重复嵌入对象、ODS 图表范围
引用或 ODF 内混合 OOXML 图表会拒绝。可拆分或另存为 DOCX/XLSX/PPTX 后导入。
文档不会上传到在线格式转换服务。复杂排版、字体和公式仍须核对原文。

Windows：Office 引擎需要与包内 Node 架构一致的 Microsoft Visual C++ v14
Redistributable（官方 x64 包请选择 x64）。没有安装时请从微软官方安装：
https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist
安装器不自动提权或安装该组件。Linux WASM 引擎需要宿主可用字体；中文文档
建议安装开源中文字体，例如 Noto CJK。开发环境需要 Node >=22.19.0。
引擎及依赖的许可、源码信息见 THIRD_PARTY_NOTICES 和 office-runtime.json。

1. 打开任意网页
2. 点击 Chrome 右侧工具栏的 CMspark 图标（拼图 → CMspark）
3. 在侧边栏输入任务，如"读取这个页面内容"、"点击登录按钮"

## 配置 LLM

默认使用 DeepSeek。如需更改：

1. 在 CMspark 侧边栏点击设置（齿轮图标）
2. 填入你的 API Key
3. 或设置环境变量: set DEEPSEEK_API_KEY=sk-xxx

## 卸载

1. 双击 uninstall.bat（zip）或用「添加或删除程序」卸载 Setup.exe
2. 在 Chrome 中移除扩展

## 数据位置

所有数据存储在: %USERPROFILE%\.cmspark-agent\
- skills/  技能文件
- history.db  操作历史
- logs/  运行日志

## 本机听写（可选）

- 组件：包内 `bin\cmspark-whisper-win-x64.exe` + DLL（或设置 → 输入与语音 →「下载本机听写组件」）
- 模型：设置 → 输入与语音 下载 small / medium（推荐）/ large-v3-turbo
- large-v3-turbo：终稿识别可能需数十秒～数分钟，无实时出字（仅 medium/small 有渐进假设）
- 数据目录：%USERPROFILE%\.cmspark-agent\models\whisper\ 与 bin\whisper\

## 常见问题

Q: Side Panel 显示"未连接到 Companion"
A: Companion 未起来。双击 launch.bat；若报错看
   %USERPROFILE%\.cmspark-agent\logs\crash.log

Q: launch.bat 提示 port 23401 not listening
A: 进程启动失败。在包目录运行: node.exe cmspark-agent.js tray
   或: wscript launch-hidden.vbs
   查看控制台错误与 logs\crash.log

Q: 端口 23401 被占用
A: 已有 Companion 在跑则无需再启；若需重启，任务管理器结束
   node.exe / cmspark-agent 相关进程后重试（不要只杀 leftover SEA）

Q: 如何更新？
A: 下载新版本 zip 或 Setup.exe，解压覆盖或覆盖安装，重启 CMspark 即可

Q: 需要安装 Node.js 吗？
A: 不需要。官方分发包已内置 node.exe，开箱即用。
   （精简版用户如需使用系统 Node.js，请确保版本 >=22.19.0）
