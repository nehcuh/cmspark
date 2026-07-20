# WP5 实施详案 — 对抗审查

> **日期**: 2026-07-20（时间锚点 13:42 +0800，本机 `date` 实测）
> **审计方**: Adversary——攻击对象是计划本身（可证伪性、证据地基、依赖闭环、恢复语义），不是代码
> **被审材料**: `docs/decisions/coordinate-computer-use-plan.md`「WP5 实施详案」:390-507（3 迭代 I1/I2/I3 + 协议清单 + L2 stub 接入设计 + 验收映射 + 自列 5 攻击面）
> **实读核验**: `preprocess.js`（spike 预处理实物）、`locate-chain.ts:428-433`（L2 stub 实物）、`executor.ts:572`（reL2 通道）、`config.ts:308-318`（normalize 先例）、`scripts/verify-systray2.js`+`systray2-sha256.json`（先例）、`scripts/spike/s1-tinyclick-onnx/ADDENDUM.md`（G5/T5 归档）、git 跟踪清单（冻结基线产物）
> **纪律**: 只读 + 写本文档；不改代码、不改详案

## 裁决: `SOUND WITH AMENDMENTS`

详案的骨架经得起攻击：迭代划分与依赖顺序可编译可回滚（admission 关闭 ≡ 今日 stub，plan:480）；L2 stub 实装设计保守正确（降级日志/locateAttempts 四字段一字不动，实物 locate-chain.ts:429-430 与引用一致）；防信任放大已从「文案纪律」升级为「类型契约」（experimental 标记 + confidence 缺省 + reL2 强制通道，reL2 实物 executor.ts:572 存在）；自列 5 攻击面质量高且与前轮裁决同源；所引 spike 数据（hybrid 705MB/836MB/736ms/token 7/7、decoder ≈6%）与 ADDENDUM:13-17 逐项吻合。

**但有两处 HIGH 必须开工前修正**：① **预处理语义断裂**——详案写 letterbox，而全部 spike 证据是 stretch，G1 将测出错误管线的包线常量、I2 将建出证据地基之外的管线；② **验收不可证伪**——「达 G1 测定包线值」是自己测自己定阈，任何实测值按构造通过。两者都是文字级可修（证据与冻结产物已入库），故不判 FLAWED；两者都直击证据链地基，故不能判 PLAN SOUND。

---

## 发现清单

### P1-a（HIGH，必修）预处理语义断裂：详案 letterbox vs 全部 spike 证据 stretch

- **一句话**：WI-2.4（plan:436）写「768² **letterbox** 双线性 resize」、测试含「letterbox 黑边区映射正确」（plan:437），但 S-1 parity / W2 正确性与延迟 / S-3 准确率 / ADDENDUM 三变体的**全部**实测都跑在 **stretch 独立双轴缩放**上——letterbox 是证据地基之外的另一种预处理。
- **证据**：`preprocess.js:14-17`——`xRatio=sw/dw` 与 `yRatio=sh/dh` 独立、零 padding，即 stretch；S-1 的 token 级一致（ORT≡PyTorch）正是 JS stretch ≡ HF processor（`do_resize` → (768,768)，Florence-2 训练/评测同款 stretch）的证明；`s3-run.js:82` 坐标反变换是**逐轴**线性映射（x=bin/1000×W），与 letterbox 的单比率+偏移映射不是同一函数。
- **后果链**：① Florence-2 训练分布是 stretch 全帧内容，letterbox 的黑边 + 内容缩并（16:9 下内容仅占 768×432，有效分辨率较 stretch 再降 ~44%）是 OOD——已测英文 1-4px 精度证据**不再适用**；② WI-1.6 G1 扫描（plan:416）在 I1 用 s3 harness（stretch）测包线常量，I2 交付 letterbox 管线——**常量测自错误管线**；③ golden 冻结数据（pred/gt 关系）在 letterbox 下全部改变，验收锚点失效。
- **计划怎么改**：WI-2.4 改为 **stretch 逐轴缩放**（与训练及全部 spike 证据一致），反变换维持逐轴线性映射（往返 ≤1px 测试保留）；删除「黑边区映射」测试；plan:130 的 letterbox 措辞一并勘误；若未来 ROI 裁剪确需保比例，letterbox 仅作 ROI 分支且**先重跑 S-1 parity + golden + G1 包线**再启用。

### P1-b（HIGH，必修）「G1 测定包线值作基线」是不可证伪的伪验收

- **一句话**：验收映射（plan:487）把被 S-3 证伪的 55% 预注册线改写为「包线内子集达 G1 测定包线值」——G1 既测量又定阈，**任何实测值按构造通过**，I3 出口标准失去可证伪性；规划者自曝的最弱点属实，且未给锚定方案。
- **为什么不算降标的锚法**：冻结基线产物**已在 git**——`golden.json`（19 case + HF 参考 input_ids）、`s3-golden-result-{int8,fp32}.json`（逐 case 预测/偏差/命中）、ADDENDUM 三变体同批数据（:11-19）均入库，提交历史保证不可回溯篡改。
- **计划怎么改**：验收改写为「生产管线在**相同图片/case** 上复现冻结测量值且在容差内」——① 包线内英文命中 case：坐标偏差 ≤ spike 冻结值 +2px（f-ok-en 3.6px、f-icon-en 1px 为锚）；② 包线外拒绝率 100%；③ 延迟 ≤ 同批 hybrid 冻结值 ×1.5。G1 职责收窄为**导出包线常量**（token 上限、句式判定）与校准曲线——它把包线边界定量化，但不定准确率阈值；阈值是 S-3 冻结数据定的。「降标」质疑由此可答辩。

### P2-a（MEDIUM）熔断状态模型缺口：禁用不可见、恢复无知情点

- **一句话**：WI-2.1「层禁用至重启 + 审计」（plan:427），但 `modelStatus` 枚举（plan:468）只有 `absent/downloading/ready/error`——**无 disabled/circuit-open 态**；熔断后面板仍显示 ready（WI-3.4 状态行误导），「重启恢复」无 UI 知情点，跨重启反复熔断无升级语义。
- **计划怎么改**：枚举增 `"disabled"` + 熔断时广播状态与原因；设置页显示「已熔断，重启后恢复」；增手动「重置熔断」动作（免重启，连续两次熔断后强制手动）；测试补熔断状态广播形状。

### P2-b（MEDIUM）自托管发布链孤儿项 + manifest url 占位

- **一句话**：manifest url 为「自托管发布链占位（待 owner 定 host）」（plan:467/495），而首轮对抗:62④ 既定的「发布账号安全（2FA/发布流程/哈希重登记走 PR）写入文档」在详案**无工作项承接**；host 未定前真实下载路径不可端到端演练，I1 出口标准（plan:398「全链路带负测试」）实际只能覆盖 fake fetch——「可独立提交」实为「不可独立验收」。
- **计划怎么改**：增 WI-1.8（或并入 WI-1.5）：发布链安全流程文档（账号 2FA、发布 PR 双人、哈希重登记走 PR、发布物与 manifest 同提交）；owner host 决策列为 I1 出口标准的**显式外部依赖**，未定前 I1 标记为「代码完成、E2E 待 host」的诚实半成品态。

### P3-a（LOW-MED）自研 BPE 等价性证据偏薄

- **一句话**：WI-2.4 测试仅「spike 录制的参考向量」（golden.json 19 条 + WI-1.6 新增）——固定向量防回归、不防未知边界分叉（GPT-2 byte-level 的 Ġ 空格、标点粘连、`.lower()` 模板折叠边界）。
- **缓解**：包线已限 ASCII 英文（非 ASCII 层内拒绝，plan:447）；token 错位最坏后果 = reL2 上的错误建议（L2 人审兜底，非静默误点）。
- **计划怎么改**：增 dev 机差分 fuzz（≥1000 随机 ASCII 命令 + 官方模板，HF tokenizer 作参考，本机门禁同 golden 惯例），零分叉方锁定；tokenizer.json 解析器加畸形输入 fuzz（2.3MB 数据文件本身是 DoS 面）。

### P3-b（LOW-MED）超时/冷启动策略未定：慢机自熔断与重建窗口

- **一句话**：5s 超时（plan:126 预注册）对 hybrid@8 实测 736ms（ADDENDUM:17）余量充足，但 ① hybrid@4 未测（S-3 只测 fp32/int8@4），低压 U 系机 e2e 可能 3-6s，超时在真实低端机上边缘；② 超时计入熔断（plan:427）→ 慢机「超时→重建→再超时」自熔断且用户无感知（与 P2-a 叠加）；③ terminate 后懒重建 = 705MB 重读+复验+重建（数秒），期间请求语义未定义；④ 首推理有 arena 冷分配（W2 RSS 实测）。
- **计划怎么改**：懒加载期跑一次 warmup 推理（arena 预分配 + 用户首推理是热的）；补测 hybrid@4 写入超时叙事；重建期请求 fail-fast 返回 `model-not-ready`（不排队）；超时策略文档化（固定 5s + 慢机后果声明），熔断计数排除冷启动超时。

### P3-c（LOW）并发与 ready 语义未定义

- **一句话**：单飞「拒绝并发」的调用方语义未写；`modelStatus:"ready"` 是「文件在盘且校验过」还是「session 已建」未定义——懒加载期间的 admission 判定依赖此定义。
- **计划怎么改**：ready = 文件在盘且校验过（session 懒建）；单飞 busy → `tinyclick-busy` skipped 链继续；重建期 → `model-not-ready`。

### P3-d（LOW）三层开关交互文案缺位

- **一句话**：`computer.model.set_enabled` × `coordinateEnabled` 主开关（config.ts:104-109 实物）× per-app `coordinateAllowed` 的用户心智模型未规定——「开了实验层没反应」的支持成本。
- **计划怎么改**：WI-3.4 设置页模型状态行在主开关关/当前 app 未允许时显示依赖提示。

### P3-e（LOW）.part 陈旧分片清理未入测试

- **一句话**：WI-1.2（plan:404-405）有断点续传/原子 rename/预算前置，但无 stale `.part` 清理与续传过期（跨 manifest revision 复用旧分片可拼出旧哈希文件——校验兜底但叙事混淆）。
- **计划怎么改**：测试补「stale .part（超期或 revision 变更）删除重下」。

## 对规划者自列 5 攻击面的覆盖度评价

5 条均成立且与前轮裁决同源（manifest 信任放大 / TOCTOU 退化 / worker 边界+崩溃循环 / 实验层放大 / 下载器面），方向正确、审计焦点具体。**但不够**——漏掉的恰是本次两条 HIGH：① 预处理语义（P1-a，所有人都盯着哈希与权限时，准确率证据的地基被静默换掉）；② 验收可证伪性（P1-b，自曝最弱点但未给锚）；外加状态模型（P2-a）、发布链孤儿（P2-b）、超时/冷启动（P3-b）三个执行面。结论：攻击面清单需从「供应链+运行时」扩展到「证据链+状态语义」。

## 修正清单（开工前落回详案）

| # | 修正 | 落点 |
|---|---|---|
| M1 | stretch 取代 letterbox + 删黑边测试 + plan:130 勘误 | WI-2.4（plan:436-437） |
| M2 | 验收锚定冻结基线（+2px / 拒绝率 100% / 延迟 ×1.5），G1 职责收窄为常量导出 | 验收映射（plan:487） |
| M3 | modelStatus 增 disabled + 熔断广播 + 手动重置路径 | WI-2.1/协议清单（plan:427/:468） |
| M4 | 发布链安全流程工作项 + host 决策列为 I1 显式外部依赖 | 新增 WI-1.8（plan:467/:495） |
| M5 | tokenizer 差分 fuzz + 畸形输入 fuzz | WI-2.4（plan:437） |
| M6 | warmup 推理 + hybrid@4 补测 + 重建期 fail-fast + 熔断排除冷启动 | WI-2.1/WI-2.3（plan:427/:433） |
| M7 | ready/busy 语义定义 + 三层开关文案 + stale .part 测试 | WI-3.2/WI-3.4/WI-1.2 |

## 探针记录

| 探针 | 结果 |
|---|---|
| 读详案 :390-507 全文 | 3 迭代 + 协议清单 + 接入设计 + 5 攻击面 |
| `preprocess.js:14-17` | **stretch 实证**（独立双轴比率、零 padding） |
| `locate-chain.ts:429-430` | stub 实物与详案引用一致 |
| `executor.ts:572` / `config.ts:308-318` / `SettingsSlideout.tsx` / ADR-010 | reL2 通道 / normalize 先例 / 设置面板 / ADR 均存在 |
| ADDENDUM:11-24 | hybrid 736.1ms / 705MB / 836MB / token 7/7 / decoder 46ms≈6% 与详案吻合；fp32 1821ms 热节流修正声明在案 |
| `git ls-files` | golden.json、s3-golden-result-{int8,fp32}.json、vendor/ 均已跟踪——冻结基线在库 |
| `scripts/verify-systray2.js` + `systray2-sha256.json` | 校验先例存在 |

---

*WP5 详案对抗审查 v1.0 — 裁决：SOUND WITH AMENDMENTS（M1/M2 开工前必修；M3-M7 进对应工作项测试清单）*
