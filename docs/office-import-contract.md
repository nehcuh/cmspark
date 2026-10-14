# Office 导入契约

现有格式与用户操作见 [文件上传](../README.md#文件上传)。解析成功只表示本次提取完成；复杂排版、多工作表公式和业务正文完整性仍需要核对实际文件。缺字体提示属于显示元数据，不进入知识正文或模型的文档正文。

## 上传 MIME 与迁移

`resolveDocumentMime(filename, mime)` 只在上传 MIME 为空、`application/octet-stream` 或 `binary/octet-stream` 时，根据已知后缀推断格式；显式未知 MIME 不被后缀覆盖。Linux WPS 的标准 PDF 别名 `application/wps-office.pdf` 归一为 `application/pdf`，然后仍须通过上传白名单。

聊天入口的 `effectiveUploadAllowedTypes` 将**规范化后集合恰好等于历史十项默认 MIME**的配置视为旧产品默认，按当前默认格式判断放行，不写回内存缓存或磁盘配置。手工录入恰好同集也会触发此约定；迁移无法区分这两种来源。自定义子集、超集保留原有限制；空列表仍表示不按 MIME 限制。需要严格限制时，请配置实际允许的具体 MIME。

白名单项通过无文件名的 `resolveDocumentMime("", item)` 比较，所以泛型 MIME 项不会推断 PDF、DOCX 等格式，也不是通配符。上传 `report.docx` 的泛型 MIME 可以被推断为 DOCX，但只有白名单允许 DOCX（或空白名单）才会进入解析。

## 临时路径与转换失败

`safeUploadBasename` 使用宿主 `path.basename` 并移除 NUL，拒绝空值、`.`、`..`；它不是通用分隔符拒绝器。POSIX 主机的反斜杠通常保留在 basename 中。真正传给解析/转换引擎的路径由 `parseOfficeFile` 在自己创建的临时目录中生成：`input.<sourceExt>`、固定映射的 `normalized.<targetExt>`。原始上传名称不作为引擎路径。

`documentExtension` 取最后一个点之后的部分。空后缀可从明确的 MIME 补全；含路径分隔符或未知后缀不会触发猜测转换重试，可能在临时写入或解析时失败。路径回归直接监视真实 `parseFile` 的临时写入、清理和转换参数；其中引擎使用受控拒绝，仅证明调用契约，不声称真实转换成功。真正的转换异常、ZIP 拒绝、取消和预算错误必须原样沿失败路径返回，不能降级成文本成功。

## ODF 计费与依赖耦合

`validateOdfExpansion` 保留全局 50,000 次列循环、100,000 XML/展开节点、8 MiB XML、8,388,608 UTF-16 展开文本单位及深度 128 上限。DOM 构建的 warning/error/fatalError 都拒绝，并归一为固定中文 XML 损坏提示；命名空间检查和后续预算计费继续执行。同步 DOM 工作不能靠 JavaScript 超时强行中断，节点/深度检查也不是 DOM 原生内存的硬上限。

空白 ODS 尾行可使用当前依赖的常量工作例外；多个空段落会产生换行，不能当作空行略过。`draw:frame` 仍保守计费，即使当前 producer 对 bare frame 不输出行。`text:s` 的子文本探针说明当前 producer 忽略该非法子结构，只输出指定空格，不能据此承诺非法结构的保真支持。

主 `content.xml` / `styles.xml` 不作为图表附件计费，但其 XML/表格/正文仍计费。主文档带 `chart` 命名空间不等于图表附件；实际嵌入对象采用依赖的 basename/suffix 解析并检查重复引用。图表属性值、名称、数据集×标签广播和保留副本纳入共享预算；ODS 图表范围引用、ODF 内嵌 OOXML 图表继续明确拒绝。

升级锁定的 `officeparser` 时，应同时重跑真实 producer 回归：`text:s`、换行/bare frame、主文档与嵌入图表、对象路径解析、数值和多工作表输出。不能只按 XML 标签名更新成本模型，也不能以改变预算来掩盖兼容问题。

## 验收来源与剩余限制

`odf-expansion.test.ts` 用构造的小型 ODF 字节调用真实 `OfficeParser.parseOffice` 和 `parseFile`，另在有界子进程中测量合成两工作表的 50,000 列边界（并拒绝 50,001）。它记录单次耗时和最大 RSS，不是生产吞吐基准。现有 `office-611` 文件的来源另见其 fixture README；任何合成探针都不代表真实大型业务工作簿验收。

#615 的授权大型多工作表语料验收仍依赖外部提供文件。收到后需核对关键正文、表数值、表来源及时间/内存表现；在此之前该子项保持外部阻塞。遇到拒绝可拆分或用原编辑器另存为 XLSX；不自动提升预算，不声称真实大型表兼容已完成。
