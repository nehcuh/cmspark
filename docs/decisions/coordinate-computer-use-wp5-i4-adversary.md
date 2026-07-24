# WP5-I4 实现对抗审计 — 实验层用户开启路径

- **日期**：2026-07-21（机器锚点 2026-07-21T08:24+0800）
- **审计对象**：I4 五提交（`36780fb` WI-4.1 → `b087696` WI-4.2 → `bc12053` WI-4.3 → `2747477` WI-4.4 → `946c980` WI-4.5）+ 评审文档（PASS，7 条 INFO）+ 实施笔记
- **审计方式**：只读对抗——七条指定攻击角度逐一读码（行号在案），两侧 tsc/套件/冒烟双臂/golden 双臂**全部独立亲跑复现**，不采信评审结论；不改业务代码
- **已闭环不重复报**：I1–I3 全部、I4 计划对抗 P1–P10、评审 7 条 INFO（本档仅在新证据处引用）

---

## 裁决：**SOUND WITH MANDATORY FIXES**

开启路径全链（license 门 → 生物识别门 → config → admission → G4）每跳 fail-closed，架构与六条设计裁决和代码形态逐一吻合，七攻击角度中五角干净闭环。**一处必修**：download/delete handler 级无状态互斥（P1，LOW-MED）——当前被 UI 按钮态与 `.invalid` 禁网双重遮蔽，属「接缝未设防」而非现行漏洞，但该迭代交付的恰是这条接缝，且计划自列攻击面 4 点名问的就是它。余五项 LOW/NIT。M1 修复窗口：**owner host 决策落地（下载路径对普通用户真实可达）之前**。

---

## 亲跑验证记录（2026-07-21T08:24–08:40+0800，独立复现）

| # | 项 | 方式 | 结果 |
|---|---|---|---|
| 1 | companion 类型检查 | `tsc --noEmit` | exit 0 ✅ |
| 2 | companion 门禁套件 | `tsc -p tsconfig.test.json` + `node --test`（computer+apps 口径） | **660/660**（5 suites，与评审口径精确吻合）✅ |
| 3 | 扩展类型检查 + 套件 | `tsc --noEmit` + 重建 .test-dist + `node --test` | exit 0；**196/196** ✅ |
| 4 | 冒烟 hybrid 臂 | `verify-tinyclick-enable-smoke.js --variant hybrid` | 全断言通过；注入点 (481,169) vs 锚 (481,169) dist=0.0px ✅ |
| 5 | 冒烟 int8 臂 | 同上 `--variant int8` | 全断言通过；dist=0.0px ✅ |
| 6 | golden hybrid 臂 | `verify-tinyclick-golden.js --variant hybrid` | **16P/3R/0F**（F-1 冻结基线一致）✅ |
| 7 | golden int8 臂 | 同上 `--variant int8` | **17P/2R/0F**（一致）✅ |

---

## 七攻击角度逐项裁决

### 角 1 · set_enabled 门流 —— 次序正确，无跳过/重排路径；TOCTOU 方向 fail-closed

读码核实（model-handlers.ts:266-326）：handler belt（:257-260，五 type 统一复核 source）→ 禁用免费+dispose（:270-284）→ declined 恒拒（:288-293）→ license 双要素（:294-300，**该分支零 setComputerModelFields 调用**，冒烟 :177 实证零写入）→ 通道存在性（:302）→ D2 门（:307-313）→ **批准后才写 config**（:321）。顺序硬编码于单一 case，无跳转/重排面。

- **TOCTOU**（门等待期间并发 decline/手改）：门批准后写 `modelEnabled:true` 与 `declined:true` 可共存，但 admission ②（model-admission.ts:183）恒拦 declined——**方向 fail-closed**，登记为已知无害竞态。
- **manual-nonce 强度**：挑战每确认新鲜生成、响应 origin 绑定、3 次锁死（MAX_NONCE_ATTEMPTS）、45s 超时、UI 禁粘贴；重放 = pending 已消费即 unknown。真实强度边界（防 LLM 工具循环、不防有 shell 同级脚本——挑战经同源 WS 可读可回声）已如实入实施笔记 §4，D2 门族固有非 I4 新引入。**闭环。**

### 角 2 · license_response —— 哈希覆盖全文，改标点即漂移；declined 持久化与复位文案一致

`LICENSE_DOOR_TEXT_HASH = sha256(LICENSE_DOOR_TEXT).slice(0,12)`（model-license.ts:125-128）**模块加载时对完整文本常量计算**——任何字符/标点变动 → 哈希变 → enable 侧（handlers :294 `modelLicenseAccepted` 双要素）与 admission 侧（admission :184）**双处重门**；扩展渲染 license_required 载荷原文（SettingsSlideout.tsx:636），用户所读即所签（同出一常量）。declined 持久化 = `setComputerModelFields` 白名单（config.ts:530-541，不含 modelVariant——P3 落实），复位 = 手改 config + 重启（缓存不热加载），LICENSE_DECLINED 错误文案（:290）与 UI `licenseDeclinedNotice` 均如实告知复位路径。**闭环。**

### 角 3 · admission 真值表 —— 64 组合无 fail-open；求值时机 = 任务创建时（与登记一致）

判定序（model-admission.ts:182-227）逐行核：①`cfg?.modelEnabled !== true`（cfg undefined → refuse，:182）→ ②declined（:183）→ ③license 双要素（:184）→ ④既有会话熔断（:203）→ ⑤外来会话 meta 缺失 refuse（:189，SESSION_FOREIGN）→ ⑥单飞懒建失败 refuse（:216）→ ⑦落地 stillEnabled 复核（:218-226）。开关×license×declined×熔断×会话存在×外来 64 组合逐一枚举：**唯一放行形 = 开关开 + 未 declined + 时间戳与哈希双中 + 无熔断 + （会话持 meta ｜ 懒建成功且落地复核过）**——其余全 null，无 fail-open 行。单飞竞态（并发共享 Promise、delete 幂等、成功路径 :215→:227 同步无交错窗口）与 dispose×build 竞态（stillEnabled 生产接线 server.ts:2013 重读 config）均闭合。求值时机 = runComputerTask **前**（server.ts:2007-2015，:2079 注入）——任务创建时一次，per-task 不收回与笔记 §6 登记一致。**闭环**（一处防御性硬化建议 → P4）。

### 角 4 · download/delete —— 幂等接缝完好；**状态互斥缺失（P1，本档唯一必修）**

幂等面核实：进程级 `activeDownload` 单飞（handlers :141/:208/:232/:372）防 download×download；I1 下载器 .part/meta/Range 续传/stale 清理/流内截流/复验 rename 全链在案（model-download.ts 全读）；禁网兜底 `isPlaceholderHost` every-URL 判定（:144-153）+ 零网络 fail-fast（:385-391）实证于冒烟（零进度广播断言）。

**缺口**：delete（:398-415）不查 `activeDownload`、download 不防 delete 进行中——

- **下载中 delete**（伪造 source WS 消息可达；UI 按钮 :591 在 downloading 态禁用故面板不可达）：delete 先 dispose 会话（:402-409）再 `rm -rf`（:410 无 try/catch）——Windows 上 .part 写流占用 → rm EPERM → 裸 fs 错误经顶层 catch（server.ts:3295-3300）转 error frame，**删除未生效、会话已被 dispose、下载完成后文件复现**；类 Unix 上 rm 胜、下载终段 stat 失败 → 下载以误导性 `network-error` 收尾（审计留痕但原因失真）。
- **delete 中 download**（无互斥标志）：`mkdir recursive` 与 `rm recursive` 竞态 → rm ENOTEMPTY 或「删除成功但文件随即重建」。

当前暴露面校准：`.invalid` 占位禁网 → 生产须显式配 `modelMirror` 才有活跃下载，实际可及者≈镜像配置用户（owner/dev）；UI 按钮态屏蔽面板路径。**但 handler 是信任边界**（本仓全库 belt-and-braces 哲学——围栏不设于 UI 假设之上），且计划自列攻击面 4 正点名此接缝。修复小而可测（互斥标志 + 诚实错误文案 + 竞态测试）→ 立 **P1（LOW-MED，必修，窗口 = owner host 决策落地前）**。

### 角 5 · 扩展透传 —— 网页不可达；广播有序；进度风暴立 LOW

- **来源**：Plasmo 清单无 `externally_connectable`、无 content_scripts 声明（package.json:40-55）、全仓无 window↔runtime 消息桥（grep 实证）——`chrome.runtime.sendMessage` 仅扩展自有页面（sidepanel/popup）可调，**网页/内容脚本伪造面不存在**；background 六 case 白名单透传（index.ts:737-743）不注入额外信任，source 由面板固定注入（SettingsSlideout :513/:527 等），companion 双层围栏不依赖其真实性（声明式边界自承）。
- **无乐观更新**：reducer 仅响应广播（agentStore.tsx:444-457），非下载中 state 清陈旧进度（:445-449）；WS 单连接保序 → 状态错序面不存在。
- **进度风暴（P3）**：下载器 per TCP chunk 回调 onProgress（model-download.ts:386-388）→ 每 chunk 一条广播 → store 每消息重建状态对象。705MB 快网下 ≈ 万级 dispatch/十秒级窗口——功能不坏但违背裁决 6「简化」意图，LOW。

### 角 6 · 冒烟 harness —— fake 门无生产泄漏；dist 断言强度如实定级

- **fake 门泄漏面**：harness 以**调用级第四实参**注入 `deps.gate`（verify-tinyclick-enable-smoke.js:154-159/171 等）；生产 message-router 调用**不传 deps**（message-router.ts:979-982 实证）→ `deps.gate ?? requireAppsBiometric` 落真门；无环境变量/构建旗标后门。**无泄漏。**
- **dist 断言强度**：harness 头注释（:21-22）称精度对账「非断言仅打印」，但 :365 实有 `dist ≤ 64px` 断言（注释陈旧，行为正确——P6 NIT）。观测 0.0px = 同 fixture 同模型贪心解码的确定性复现（双臂亲跑均 0.0），非构造性平凡；64px/1920 宽为冒烟级 sanity（3.3%），准确率判定归 golden 门禁——强度定级**适当**。
- 附带核实：隔离 DATA_DIR、模型 junction、capture 隔离副本（§10 fixture 事故纪律）均在案且生效。

### 角 7 · PNG 解码器 —— 畸形面全 fail-closed；inflate 无输出硬顶立 LOW

全读 178 行：签名/IHDR 首位/chunk 截断/尺寸 8192²/16-bit/调色板/Adam7/未知过滤全拒绝；allocUnsafe 全程覆写（过滤 0-4 各路径逐字节写满，无未初始化泄漏——评审主张复核成立）；畸形矩阵 5 测在 660 口径内亲跑绿。**zip-bomb 面（P2）**：`inflateSync(Buffer.concat(idat))`（:100）未传 `maxOutputLength`——`expected = height*(1+stride)` 在 :105 才计算且 inflate 前 IHDR 已知宽高位深，硬顶可前移；现行路径下超限输入先全量解压（上限 buffer.constants.MAX_LENGTH）再长度比对（:106）。输入源收敛于本机采集进程输出 + shot.sha256 证据链上游，篡改需同级用户（ADR-010 边界内）——纵深防御一行修，LOW。

---

## 发现清单

| 编号 | 严重度 | 一句话 | 是否需代码修复 |
|---|---|---|---|
| **P1** | **LOW-MED** | download/delete handler 级无状态互斥——下载中 delete（Windows rm 撞占用 .part → 裸错误+会话已 dispose+文件复现；类 Unix 下载以误导性 network-error 收尾）、delete 中 download（mkdir/rm 竞态）；当前被 UI 按钮态与 .invalid 禁网遮蔽，但 handler 未设防 | **是（必修）**：activeDownload/删除互斥标志 + 诚实错误文案（「下载进行中，完成后重试」及反向）+ 竞态测试；窗口 = owner host 决策落地前 |
| P2 | LOW | png-decode inflateSync 无 maxOutputLength——IHDR 尺寸 inflate 前已知，expected 硬顶可前移一行 | 建议（纵深）：`inflateSync(buf, { maxOutputLength: expected })` + 炸弹负测试 |
| P3 | LOW | 下载进度广播无节流（每 TCP chunk 一条，705MB≈万级 dispatch），扩展每消息重建 store | 建议：companion 按整百分点/≥200ms 节流（或扩展 rAF 合并）+ 测试 |
| P4 | LOW | server.ts:2007 admission 调用无 try/catch——内部已全 catch（buildSession :152-163）+ getStatus 为字段委托读（tinyclick-session.ts:141-147），但一处防御 catch 可使「admission 异常永不拖垮 UIA/OCR 兜底」语义密闭 | 建议：try/catch → 视同 locator=null + loud log |
| P5 | NIT | P9 启动 WARNING 文案「经 config.json 手动开启」对**经门合法开启后重启**同样触发（持久化 config 无法区分两源）——文案过归因 | 建议：改述「实验层处于开启状态（含手改 opt-in 形态，ADR-010）」 |
| P6 | NIT | 冒烟脚本头注释（:21-22）称精度对账「非断言仅打印」，与 :365 ≤64px 断言不一致——行为正确，注释陈旧 | 建议：注释与断言对齐 |

**评审 7 条 INFO 复核**：抽查 F-1（dispose 豁免窄性——tinyclick-runtime.ts:567-580 复用 disposed 首句置位、审计留痕，成立）、F-2（门流次序，角 1 复核成立）、F-3（stat 级复验边界，probeModelDir :106-125 注释诚实，成立）、F-7（config.test 0o600 既有基线，未复跑该口径，采信其 git 考古）——无异议，不重复立档。

**正面确认（防后续轮次误判）**：holder 三写入点 grep 证据（笔记 §2）本轮复核行号一致；validateWsMessage 四条目 + belt 五 type 双层面名实相符；MODEL_SWITCH_COPY P2 文案（per-task + estop 引导）与扩展镜像互锁测试在两侧套件内亲跑绿；P7 刷新链回归在 660 口径内实绿；许可证门 Modal 渲染载荷原文、X/遮罩仅闭门 fail-closed；golden 双臂与 F-1 冻结基线完全一致（亲跑）。

---

## 修正清单

| 编号 | 严重度 | 窗口 | 内容 |
|---|---|---|---|
| **M1** | LOW-MED（必修） | owner host 决策落地（下载真实可达）前 | download/delete 互斥：delete 查 activeDownload → 拒+诚实文案；download 查删除进行中（或统一 busy 标志）；deleteImpl 错误归一为结构化返回；竞态测试 ×2（P1） |
| M2 | LOW | 随下一迭代 | png-decode maxOutputLength 硬顶 + 炸弹负测试（P2）；下载进度节流（P3）；server.ts admission 防御 catch（P4） |
| M3 | NIT（捆） | 随下一迭代 | P9 WARNING 文案过归因修订（P5）；冒烟头注释与 ≤64px 断言对齐（P6） |

---

*WP5-I4 实现对抗审计 v1.0 — 裁决：SOUND WITH MANDATORY FIXES（M1 必修于 owner host 决策落地前；M2/M3 随下一迭代；七角度中五角干净闭环，I4 其余交付面与评审 PASS 结论一致）*
