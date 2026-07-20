# WP5 交付变体决策记录 + 自托管发布链安全流程

> **日期**: 2026-07-21 ｜ **状态**: I1 收口（变体决策 B8 + 发布链流程 M4）
> **上游**: plan `coordinate-computer-use-plan.md` WP5 WI-1.5/WI-1.8；backlog B8；W3 证据包 `coordinate-computer-use-wp5-model-provenance.md`；对抗修订 M4（`coordinate-computer-use-wp5-plan-adversary.md` P2-b）
> **数据来源**: 全部数字为 spike 冻结实测（S-1/S-2/S-3 报告与 ADDENDUM，提交历史可溯），本文不新增未核实声明

---

## 1. 交付变体决策（B8：三轴三选）

| 变体 | 体积 | RSS | e2e 延迟 | token 级回归 | 裁决 |
|---|---|---|---|---|---|
| **hybrid**（vision fp32 + enc/dec/embed int8） | 705MB（704,780,632B 实测，manifest 四图合计；含 tokenizer.json 共 707,078,593B） | 836MB | 736ms | 7/7 逐位一致 | **默认交付变体** |
| int8（全量化） | 432MB | 570MB | 1173ms | 7 token 中 6 位一致（1 bin 抖动，无语义改变，S-3 已证） | 内存硬约束备选（保留在 manifest，非默认） |
| fp32（未量化） | 1.24GB | ~1.9GB | 体积/速度双劣于 hybrid | 7/7（spike 基线） | **不交付** |

**决策理由**：

1. **hybrid 为默认**：736ms 是唯一能进交互预算的实测值（int8 慢 ~59%，fp32 更慢且体积近两倍）；836MB RSS 在目标机型（8GB+）可承受；token 7/7 与 fp32 基线逐位一致，量化无语义损耗。
2. **int8 保留为备选**：RSS 570MB 是内存硬约束机型（4GB/重负载）的唯一可行变体；432MB 下载量也更小。1 bin 抖动事实已登记（S-3 token 级回归：7 token 中 6 位一致、输出坐标无语义改变）。
3. **fp32 不交付**：1.24GB 体积 + 1.9GB RSS + 速度劣于 hybrid，三轴全无优势。
4. **manifest 登记**：hybrid/int8 双变体每文件 sha256+size 已实测录入 `companion/models.manifest.json`（WI-1.1；两变体共享 decoder/embed/encoder 三图，仅 vision_encoder 不同——hybrid 用 fp32 版 `af096239…`，int8 用量化版 `895011bd…`）。

**与 plan 假设的修订关系**（backlog G5 已执行）：plan:118 的 250-350MB 估计被实测 432MB（int8）/705MB（hybrid）修订；plan:126 的 int8 提速隐含假设被实测反转（int8 慢于 fp32/hybrid），以本表为准。

## 2. 自托管发布链安全流程（M4：发布物与登记同源）

模型 ONNX 工件不进 git、不进安装包，经**自托管发布链**分发（host 待 owner 决策，见 §3）。发布链是 manifest 哈希叙事的根——流程要求：

1. **发布账号强制 2FA**：托管账号（对象存储/Releases 渠道）必须开启双因素认证；发布凭据不进仓库、不进 CI 明文。
2. **发布 PR 双人 review**：任何发布动作（新变体上架、旧工件替换）走 PR + 至少一名非作者的 reviewer；reviewer 必须复核「发布物 sha256 == manifest 登记值」。
3. **哈希重登记必须走 PR**：`companion/models.manifest.json` 的任何变更（含 revision、sha256、size、license 字段）禁止直接推主分支；PR 描述须附重登记原因与实测命令输出（`sha256sum` 原文）。
4. **发布物与 manifest 同一次提交**：上架新工件的发布动作与 manifest 登记更新必须是同一 PR 的同一提交——防止「工件已换、登记未改」或反向漂移（两条都是哈希叙事失效面）。
5. **本地可复核**：`node scripts/verify-tinyclick-vendor.js --strict`（vendor 三文件）+ `node scripts/verify-ort-sea.js`（ORT 裁剪 staging 复刻 → ≤70MB 断言 → SEA 组装 → dummy 推理冒烟，plan:413 明定的 B7 手动/发版门禁）+ golden 回放 harness（`scripts/verify-tinyclick-golden.js`，WI-2.5）为发版前本机门禁；模型文件本身篡改的加载拒绝由 `computer-model-*.test.ts` 负测试覆盖。
6. **E2E 现状**：host 未定前，下载链路全部经 fake fetch 覆盖（`computer-model-download.test.ts`，含断点续传/分片篡改/stale .part/预算/审计形状）；**真实下载链路演练列为 owner host 决策后首日任务**（见 §3）。

## 3. 显式外部依赖与 I1 出口诚实态

- **外部依赖（唯一）**：owner 自托管发布链 **host 决策**（GitHub Releases 或既有渠道）。manifest 内 url 为 `models.cmspark.invalid`（RFC 2606 保留 TLD）占位——决策前默认禁网，任何下载尝试只会打到不可解析主机并以 `network-error` 审计落地（fail-closed）。
- **host 决策后首日任务**：① manifest url 占位主机替换为真实 host（走 §2.3 PR 流程）；② 真实链路下载演练（hybrid 全量 705MB + 断点续传 + 复验 + 加载）；③ `computer.modelMirror` 镜像文档化（hf-mirror 类公共镜像的适用边界）。
- **I1 出口诚实态（M4）**：**代码完成、E2E 待 host**。本迭代交付的下载门禁（manifest/校验即加载/下载管理器/裁剪打包/vendor 钉哈希/license 门文案/三态文案）全部带负测试入库，但「从真实 host 下载真实模型」链路在 host 决策前不可端到端演练——这不是代码缺口，是外部依赖待决。

---

*WP5 I1 收口文档 — 变体决策（B8）+ 发布链流程（M4）+ 诚实出口态。*
