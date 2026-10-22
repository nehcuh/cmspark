# Windows / Linux 活动采集适配

GitHub: #758 · Refs #752/#757 · 2026-10-22。基于隔离功能分支 head 57b80865；不迁移或更改 live config。

## 能力声明

T3；Surface L2 只读屏幕 + L0 工作中心；host_read；现有本地原生工具/本地 OCR/已配置模型组合；用户开启后单实例轮询；认证 panel、明确应用选择、独立模型同意和人工确认待办均不变。无新 Agent runtime、输入注入、切群、反馈发送或外部聊天 API。

## 交付合同

- Windows：应用身份来自实际进程映像路径的规范摘要，非标题/PID/进程名授权；枚举只回 ID/名称。安全桌面、锁屏或密码输入不可验证时跳过。前后核同 HWND/PID/进程创建时间/应用 ID/标题，复用原 Passive 截图；允许既有 Passive+AllowFallback 的不抬窗像素回退以覆盖聊天软件黑帧，严格拒绝恢复最小化、遮挡及未知质量。不恢复/激活窗口。复用原 Windows OCR，缺语言包明确错误。
- Linux X11：系统 Python3 stdlib + libX11/libXss，真实 EWMH 活动窗口、同用户 PID/实际 /proc 映像及启动标记、窗口状态、屏保、前后身份/几何核对；仅采当前允许窗口；用本机 Tesseract OCR。无 XWayland 冒充 Wayland 前台。缺桌面/依赖时明确失败，不自动安装或扩大范围。
- Wayland：全局前台身份没有通用可核实接口，自动轮询明确不可用。提供显式 PNG 导入 → 本地 OCR → 来源 → 手动整理/独立点击语义抽取。导入来源标为用户提供，不冒认应用、群、发送者或采集时刻；不自动调用模型。无桌面时同样可用显式导入（需 OCR 依赖）。此受限路径不称 Wayland 自动采集。
- 可配置本地 OCR 语言（简体中文、繁体中文、英语）；保存设置不能自动启用采集或模型。能力状态与 UI、应用标识校验三端一致，保留旧 macOS bundle ID 配置。
- 共享来源、候选、确认、督办、提醒调度/重启补查、保留与配额门不变。通知提交与已读仍分离。

## 验收

真实适配器的依赖/协议/进程边界、窗口变化、锁屏/敏感/未知、取消/迟到、PNG输入预算、源码/编译资源路径分别负控；原活动和设置、WS锁步及旧消费者回归。Linux 隔离 Xvfb/窗口管理器/自有窗口实际采集与 Tesseract OCR；Windows hosted 自有原生窗口的实际身份、被动采集和 OCR，保其他前台/最小化拒绝。控制台没有系统通知服务不能冒已展示。

先本机受影响测试/构建和受控 Linux，再独立非作者评审、Pi读取完整报告及同一差量，推送 PR/精确 CI。Windows 真实 DoD 未绿时明确未通过，不修改原超时/权限/拒绝或重复碰运气。

## 官方依据

XDG Screenshot 接口的选择/结果是授权截图 URI，没有通用的当前前台应用身份收据：https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screenshot.html 。Windows OCR 复用仓库固定 WinRT 桥；以当前 Windows 实际结果为准，不把 API 存在冒执行成功。

X11 还要求本机 Unix DISPLAY（拒绝 SSH/TCP 转发）及明确的 XDG_SESSION_TYPE=x11，并拒绝服务器 XWAYLAND 扩展；仅有 DISPLAY 不构成 X11 身份。XRes 取实际本地客户端 PID，XGetInputFocus 的服务器焦点必须属于活动窗口的真实祖先链；根属性和应用自报 PID 不授予采集范围。

X11 额外要求已运行的同用户桌面锁屏 broker。GetNameOwner 绑定唯一 owner 后只查询该连接，禁止通过读检查自动激活服务；所有未知/锁定均拒绝。XScreenSaver 不足以观察合成器自绘锁屏（Composite overlay 不在 QueryTree 内），所以在像素读取前后核同一 broker 的明确未锁定状态。原生受控 D-Bus 服务测试只是这个协议边界，不冒实际 GNOME/KDE 锁屏验收。
