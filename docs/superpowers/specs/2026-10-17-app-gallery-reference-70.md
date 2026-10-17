# #70 Gallery 首批常用应用与发行版证书参考（已批准有限实施）

GitHub: #70 — https://github.com/nehcuh/cmspark/issues/70

状态：root 已全文审定有限合同并于 2026-10-17 授权实施；真实证书值待 hostedWindows 采集，不代表整个 #70 完成。

## 目标与边界

在 bundled 预置列表保留网易云音乐，新增 Notepad++、Visual Studio Code Stable 两项，展示有官方来源的典型路径、固定发行版证书参考和每应用手动授权建议。复用现有探测、manual materialization、PresetStatus、AppPanel、owner/list-stale 和 D2。社区目录为原需求可选项，本批不做。

这是参考数据与展示，不是用户本机 exe 的证书核验。UI 必须写明“以下为指定官方发行版证书参考；未核对本机当前文件”。既有 exe.signer 只是 add-time Subject，不能显示为已匹配指纹。无需实时比较、新 apps API、AppEntry 持久字段、自动重探测、下载/安装、后台监视或新 Trust 规则。目录成员资格、指纹参考与官方来源链接都不能授予执行或提权权限。

## 有限产品与典型路径

| 新条目 | 候选 token | 第一批检测候选 | 官方依据和边界 | 建议文案 |
|---|---|---|---|---|
| Notepad++ | win.app.notepadpp | `%ProgramFiles%\Notepad++\notepad++.exe` | 固定上游 installer globalDef.nsh 的 APPNAME/InstallDir 与官方配置手册支持 Program Files 布局；首批不猜测自定义/portable目录。参考采样仅 x64 8.9.8.1，不代表所有版本/架构均已核验。 | 建议保持手动；编辑器可读写用户文件，带文件/参数仍走现有独立模板/L2规则。证书参考不授予自动权限。 |
| VS Code Stable | win.app.vscode | `%ProgramFiles%\Microsoft VS Code\Code.exe`、`%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe` | 官方 Windows 安装文档给出系统/用户目录，官方 portable 文档明确 Code.exe。首批不含 Insiders/OSS、自定义目录或猜测的其他布局。发行版参考仅 stable x64 1.142.0。 | 建议保持手动；扩展与工作区任务可运行代码。用户目录安装继续受既有 user-writable 上限约束，证书参考不提高信任。 |

官方链接：[NPP固定 installer 源码](https://github.com/notepad-plus-plus/notepad-plus-plus/blob/dd40fe45598791e9aa38f3aeb200e10fb3d6338a/PowerEditor/installer/nsisInclude/globalDef.nsh#L19-L72)、[NPP配置路径说明](https://npp-user-manual.org/docs/config-files/)、[VS Code Windows布局](https://code.visualstudio.com/docs/setup/windows)、[VS Code portable可执行文件](https://code.visualstudio.com/docs/setup/portable)。这些是典型布局依据，不是本次实际安装/文件存在证明。

## 参考记录与事实分层

每新增应用的 bundled reference 只包含：固定版本/架构、官方发行页与不可变 artifact URL、packageSHA256、referenceEXESHA256、`expectedCertificateSHA256DER`、独立 `observedSubject`、真实采样的 Authenticode status/UTC时间/回执路径，以及建议文案。指纹表示 **SHA256(leaf SignerCertificate.RawData 的 DER 字节)**，规范为64位十六进制；不是 Subject、证书 SHA1 Thumbprint、SPKI、安装包 SHA 或 EXE SHA。

`expectedCertificateSHA256DER` 的“expected”只针对这份受审固定发行版参考/采样见证；不表示已对用户机器进行运行时比较。UI 使用“发行版叶证书 SHA-256（DER）”标签，旁列版本/采样时间与“本机当前文件未核对”。Subject 标为采样 Subject，不能作为匹配依据。换证/新版本只通过后续人工审定 bundled 数据更新，不在线自动学习证书、不回写用户授权。

准备材料中的真实证书与 Subject 目前均为 UNKNOWN/null。不得用 `CN=Microsoft`、`CN=Notepad++` 或现有测试 mock 填充。不把公开 package/EXE SHA 当证书值。功能可有未知态文案，但本批对原“含签名指纹”子范围的完成声明，必须等两个固定官方样本的真实 hostedWindows 只读采样和回执采纳；缺数据是内部采集余项，不是永久外部阻断。

## 既有行为保持

仅扩展已有 PresetStatus/UI 的可选只读 reference/advice 数据；不新增 socket action，不持久化这些展示信息到 AppEntry。旧客户端/没有参考的网易云条目可无该可选数据，不虚构其历史证书。保留已有四个网易云路径与用户设置。

未检测条目不落盘；检测后仍 manual，既有 enabled/default/cap 语义不变。已有同 token 条目、用户停用/信任级别不能被参考数据覆盖或重新启用。所有 apps.list 的并发插入、兄弟保留与 config-event stale/ABA 防护照用；新展示数据不触发额外签名读取或 await。D2、vault/lolbin、user-writable/unsigned上限、模板/CLI/drift 各自门禁不改。参考链接只作为用户可读出处，不自动 fetch。

## 验收范围

1. 三个 bundled 条目（原一+新增二）；两新增路径逐字绑定官方资料，未检测不落盘，旧条目选择不被改动。
2. 每新应用具备真实固定样本的 package/EXE/leaf-certificate 独立 SHA 与采样回执；真实响应作为契约 fixture，不手造签名协议或 CN。无证书/非 Valid/采样失败时保留 UNKNOWN，不产生伪成功数据。
3. 现有 list producer→状态类型/store→gallery UI 展示版本、DER指纹、来源、建议和本机未核对说明。没有参考时不显示“已核验”；纯文本渲染，固定小文本，非 HTML。
4. 既有 manual/D2/cap、disabled/persisted、双 list/owner-stale 与兄弟条目测试保持。无新动态核验、权限或后台行为。
5. hostedWindows 只读采样不安装/启动目标、不调用应用CLI/插件、不提升信任；真实结果只证明该固定样本，不能冒充本机安装状态或整个父票完成。
