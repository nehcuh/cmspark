# ODF 真实公开语料兼容边界（#615）

本次核验使用四份英国政府公开发布的原始 ODS，不含用户业务文档。发布者、原始附件 URL、压缩字节数和 SHA256 固定在 [语料清单](2026-10-18-odf-real-corpus.json)。文件按 GOV.UK 的 OGL3（另有声明者除外）保留来源署名，不表示发布方认可本项目。仓库不提交这四份原始大表；复现实验须先核对原始字节哈希，不把随日期更新的同名附件当成同一输入。

## 原有预算与严格策略

全局预算保持：XML 8 MiB、列循环 50,000、XML/展开节点 100,000、展开文本 8 Mi UTF-16 code units、嵌套深度 128。预算跨 sheet、所选 XML entry 与嵌入对象累计，不按 sheet 重置。ZIP 容器、命名空间、图表及对象引用原有门禁继续执行。压缩文件很小也可能触发列展开拒绝；这并不等同于 ZIP 压缩炸弹。

XML parser warning 继续按损坏拒绝；没有 blanket warning suppression。DOM 构造的 ParseError/NamespaceError 保持可操作的中文错误。实际 OfficeParser 7.2.3 回归已覆盖非法 text:s 子内容被忽略、多个空段落产生换行，以及 bare draw:frame 保守计费；本次不放宽这些语义。普通六单元格重复、百万空尾行和双系列图表的实际输出回归继续作为接受正控。

ODS 列预算现于 pinned xmldom 的默认 SAX-to-DOM builder 分配单元格前收取，后面的完整 DOM 语义校验仍保留。只对 ODS 提前计费，避免改变 ODT/ODP 的行成本语义；按解析器已解码 namespace URI/localName 与同展开名属性的后值覆盖取值，covered-table-cell 不加列。该内部 builder hook 不是通用公开 SAX API；依赖升级须运行属性别名/跨 entry/完整恶意回归，接口失配或解析异常保持拒绝，不退回无预算解析。

这项修复减少高物理列量文件在拒绝前保留的 DOM。它不承诺所有 XML/注释/属性形状均低于某个堆上限，也不能中断同步 XML 解析；这里没有新增硬 wall-clock 产品 SLA。

## 实际测量

Node 22.23.2/linuxarm64、OfficeParser 7.2.3、TypeScript 5.9.3，依赖锁与公开 mainc21 字节绑定。容器 network none、无宿主挂载、cap-drop ALL、no-new-privileges。独立 Node child 的实验堆上限为 128 MiB、外层 watchdog 6s；二者是测量隔离参数，不是产品的 admission 限额或同步中断保证。CPU 为 child user/system µs；maxRSS 为 Linux KiB，包含运行时、依赖及输入，并非 guard 的增量峰值；heapUsed 仅为时点采样。

| 官方原件 | 压缩 bytes | 原 mainc21 实际结果 | child wall ms | maxRSS KiB | CPU user/system µs |
|---|---:|---|---:|---:|---:|
| Defra 补充统计表 | 1,143,326 | XML 内容大小拒绝 | 27.689 | 69,288 | 28,615 / 6,187 |
| Defra deprivation 数据集 | 1,151,613 | XML 内容大小拒绝 | 19.843 | 65,892 | 23,412 / 18 |
| MHCLG LiveTable100 | 530,734 | 实验堆上限 SIGABRT | 未取得最终值 | 未测得 | 未测得 |
| MHCLG LiveTable104 | 13,637 | 列循环拒绝 | 47.221 | 79,264 | 69,394 / 10,461 |

前三者的 content+styles 声明分别为 19,558,592 / 21,325,333 / 7,157,447B。前两件超过 XML 限额，真实 parseFile 拒绝且未加载 OfficeParser。第四件也由真实 guard 拒绝，不能因只有 13 KiB 就放宽列循环。四份均未成功转换；正向输出证据来自上述明确标记的现有实际 producer 回归，不能称作真实政府大表的成功转换。

Table100 原 full-parse child 仅有导入前记录，因此原中止阶段保留 UNKNOWN；它未触发 6s watchdog，容器 OOMKilled=false，child 的 effect exit receipt 和最终资源值未取得，不能填零。Root 另一次同堆/同 watchdog 的 guard-only 阶段隔离实际完成导入后，进入原 guard 即在约 379ms SIGABRT，未导入或调用 OfficeParser。独立流式诊断只用于解释输入：20 sheets、119,873 elements、60,232 table cells、物理列循环总和 101,138,432；它不替代产品 admission。

修复后，同一 Table100 字节与同一实验上限下，worker 独立的 Node22.23.2/darwinarm64 CPU 测量（未启动本机 native、GUI 或浏览器）中，真实 parseFile 约 52.850ms 返回中文“列循环”拒绝；CPU 60,491/5,362µs、maxRSS 109,600KiB、heapUsed 4,967,560→37,739,464B，OfficeParser 未加载，效果 guard 为零。Root 在锁定 LinuxARM 容器中的单独 guard-only 对照同样自然退出并拒绝，约 59.766ms。两者是不同实验，不能相加或冒连续 heap peak；原堆溢出和失败收据保留。

## 复现与使用建议

下载时保留清单中的完整官方 URL/哈希及许可归属；不读用户凭据或私人文件。原件只送真实 parseFile，拒绝后不绕 guard 直接调用上游大表解析器。保留每次输入字节、Node/依赖锁、原错误、child exit/signal、CPU/heap/RSS/wall 和外层 cap；缺少终态指标须记未测得。永久回归使用仓库内的代表性合成边界和真实 parser 输出，正常 CI 无需联网取政府附件。

这些是当前保守的兼容限制。超过预算时优先拆分 sheet/文件，或另存等价 XLSX；另存格式仍受本格式自己的容器/输出预算检查，并不保证任何大表均可接受。不得通过提高原限额、按 sheet 重置、抑制 XML warning、延时或 skip 换取绿灯。
