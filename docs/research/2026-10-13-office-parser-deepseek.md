# Office parser 扩展调研：DeepSeek LibreOffice Kit

调研日期：2026-10-13（Asia/Shanghai）。CMspark 基线：`3705f5da3f51a11b3c0bdf581e39737ed306d275`。本文是调研记录，不是实现 spec；未改产品代码、依赖或配置。

**结论：DeepSeek LibreOffice Kit 适合补充现有解析器，目前不适合整体替换，也不能直接解决 WPS 专有格式。** 已在本机验证旧版 Office → 现代 Office → 当前 `officeparser` 的转换链路。格式支持还受 CMspark 多处入口限制，单换依赖不能完成扩展。

**核实到的 DeepSeek 项目**

目标是官方 [deepseek-ai/dsh-libreoffice-kit](https://github.com/deepseek-ai/dsh-libreoffice-kit)，npm 包为 `@deepseek-ai/libreoffice-kit`。它提供基于 LibreOffice 的 CPU 本地转换、公式重算与页面渲染，不要求 GPU、模型权重或在线推理。

GitHub `master` 的调研固定点为 `b19bb73c74ed893b8a5d1716d32df32a113ed31b`；其文档仍指向 0.1.3，但 npm registry 的最新版本是 **0.1.5**，发布时间为 2026-10-01 UTC。本次安装并检查的是 0.1.5 的正式发布包，不能把 GitHub 文档版本当成 npm 最新版。[发布包元数据](https://registry.npmjs.org/@deepseek-ai%2Flibreoffice-kit/latest)

[DeepSeek-OCR-2](https://github.com/deepseek-ai/DeepSeek-OCR-2) 是另一条路线：图像/PDF 页面识别，官方部署示例使用 CUDA、PyTorch、vLLM/Transformers。它可以补充扫描件识别，但不负责打开 `.wps/.et/.dps` 的文件容器，不应为扩展 Office 后缀而整体接入。

**当前 CMspark 的实际边界**

- `companion/package.json` 与本机安装包为 `officeparser 7.2.3`；Office 正文调用 `officeparser.convert(tmpPath, "md")`。
- `companion/src/file-parser.ts` 的显式映射支持 DOCX/PPTX/XLSX、PDF、ODT、RTF、CSV、MD、TXT、HTML/HTM；旧版 DOC/XLS/PPT、WPS 专有后缀和 ODS/ODP 未接入。PDF 使用单独的 `pdf-parse` 路径。
- 当前安装的 `officeparser` 已声明支持 ODS/ODP。这两种格式并非完全需要新增引擎，但不能只根据声明放行，ODP 的实测存在正文遗漏。
- 限制分散在 `file-parser.ts` 的 MIME 映射和分派、`config.ts` 的上传 MIME 白名单、`message-router.ts` 的原生选择器/目录导入后缀，以及前端 `image-compose.ts`、`KnowledgeSubPanel.tsx`。会议参考文件另有 DOCX/MD/TXT 限制。
- 通用解析上限为 10 MiB，浏览器知识导入另有 6 MiB 提示，会议参考文件上限为 7 MiB；通用聊天/知识解析有 30 秒等待上限。新引擎默认上限不会自动改变这些产品限制。
- 现有扫描 PDF 路径仅在整体文本不足 50 字时尝试渲染前 10 页，依赖动态加载的 `canvas`/`pdfjs-dist`；聊天附件会按配置进行图片视觉分析。扫描件、混合 PDF、全部页覆盖仍需单独评估。

**格式对照**

| 文件范围 | CMspark 当前 | DeepSeek Kit 0.1.5 | 判断 |
| --- | --- | --- | --- |
| WPS 保存的 DOCX/XLSX/PPTX | 已有解析路径，质量视内容而定 | 支持转换与渲染 | 无需因为生成软件是 WPS 而切换解析器 |
| Office 97–2003 DOC/XLS/PPT | 当前未接入 | 支持合规 OLE 容器 | 最明确的新增覆盖 |
| ODT | 已接入 | 支持 | 可作为转换/渲染补充 |
| ODS/ODP | 上游 parser 支持，CMspark 未放行 | 支持 | ODS 最小样例通过；ODP 需要修复或转换后再提取 |
| WPS 专有 WPS/ET/DPS | 未接入 | 公共 API 不接受 | 引入 Kit 不能宣称支持 |
| RTF/HTML/CSV/MD/TXT | 已有路径 | 不在 Office 输入白名单 | 全替换会损失现有覆盖 |
| DOCM/XLSM/XLSB/PPTM、模板、OFD/UOF | 当前没有显式接入 | 不在本次核实的公共输入列表 | 不能从“基于 LibreOffice”推断支持 |
| PDF | 单独解析，部分扫描页转图片 | 直接 PNG 渲染支持 PDF | Kit 本身不是 OCR/Markdown 提取器 |

Kit 的 Office 输入白名单是 DOC/DOCX/ODT、XLS/XLSX/ODS、PPT/PPTX/ODP；另一路图像渲染接受 PDF。[输入验证源码](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/b19bb73c74ed893b8a5d1716d32df32a113ed31b/packages/entry/src/document.ts)、[图像入口](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/b19bb73c74ed893b8a5d1716d32df32a113ed31b/packages/entry/src/image-operations.ts)

Kit 不直接输出 Markdown。文字类可导出 PDF/DOCX/ODT/TXT，表格可导出 PDF/XLSX/ODS/CSV，演示可导出 PDF/PPTX/ODP。多工作表导出 CSV 要明确选择工作表；PDF 或 CSV 都不能替代完整工作簿结构。扩展读取范围时，旧格式先转现代 Office、再走现有正文/内嵌图片提取，比统一先转 PDF 更符合当前产品需求。这是基于输出能力和现有管道的判断，尚非复杂文档保真承诺。[转换矩阵源码](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/b19bb73c74ed893b8a5d1716d32df32a113ed31b/packages/entry/src/operations.ts)

**隔离验证结果**

环境：macOS ARM64，Node 22.23.2，Kit 0.1.5 原生引擎，CMspark 已安装的 `officeparser 7.2.3`。依赖仅安装到 `/tmp`，使用 `--ignore-scripts`。测试使用上游提交固定的最小文件，不含用户文档；输入以 10 MiB、转换以 30 秒限制运行。[样例来源与哈希](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/b19bb73c74ed893b8a5d1716d32df32a113ed31b/test/fixtures/README.md)

| 验证链路 | 结果 | 转换耗时 |
| --- | --- | --- |
| DOC → DOCX → officeparser Markdown | 保留 `Office preview 中文文档` | 4.804 秒，首次操作 |
| XLS → XLSX → officeparser Markdown | 保留中英文单元格文本 | 0.555 秒 |
| PPT → PPTX → officeparser Markdown | 保留中英文幻灯片文本 | 0.521 秒 |
| XLS → ODS → officeparser Markdown | 保留中英文单元格文本 | 0.676 秒 |
| PPT → ODP → officeparser Markdown | 转换成功，但 Markdown 遗漏正文 | 0.629 秒 |
| DOCX → TXT | 提取测试文本 | 0.512 秒 |
| DOCX → PNG | 成功，432 × 288，目视确认文本和红蓝色块 | 0.601 秒 |
| WPS/ET/DPS 后缀，分别请求 DOCX/XLSX/PPTX 输出 | 全部 `unsupported-format` | 入口拒绝 |

ODP 遗漏已进一步定位：`content.xml` 的 `text:p/text:span` 中仍有中英文正文，Kit 渲染的 PNG 也显示正文；ODP 再转回 PPTX 后，`officeparser` 可以重新提取正文。因此这一样例的问题落在当前 parser 的 ODP 提取路径，而非 Kit 转换丢字。这支持将 Kit 用作兼容补充，也说明“声明支持某后缀”不足以作为验收结果。

后缀拒绝测试使用的是标准旧版 Office 字节换后缀，验证公共 API 白名单，不是对真实 WPS 文档的兼容性测试。上述耗时是单机单次最小样例的观察值，不能外推业务吞吐、复杂排版、公式、批注、修订、加密文件或跨平台质量。直接调用 parser 库也不等于完成了 CMspark 上传入口的端到端验证。

完整发布元数据、转换结果、文本检查和渲染哈希保存在 [证据 JSON](2026-10-13-office-parser-evidence.json)。

**集成成本与实际收益**

- Node 最低要求是 **22.19.0**；我们的 `scripts/package.sh` 固定打包 **22.16.0**，现有发行包不能直接加此依赖。Companion 的宽泛 `>=22` 声明也需随接入核对。
- 0.1.5 npm registry 报告引擎解包大小：macOS ARM64 **153.16 MB**、macOS x64 **163.00 MB**、Windows x64 **190.87 MB**、Windows ARM64 **180.01 MB**、Linux WASM **152.36 MB**。这些是引擎包解包字节数，不是下载大小、整机安装占用或峰值内存，也不包括字体和其他依赖。不能引用 README 的历史 XZ 测量当当前 npm 包体积。各平台精确元数据见证据 JSON。
- Mac/Windows 使用匹配架构的原生包，Linux 使用 Node WASM；Mac/Windows 不回退到 WASM。Windows 需要匹配架构的 VC++ v14 runtime。引擎和资源须完整分发，Windows SEA 还需验证包定位、Worker 与旁置资源，不能假定 esbuild 把它一起打进单文件即可。[平台与打包文档](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/b19bb73c74ed893b8a5d1716d32df32a113ed31b/docs/packaging.md)
- 字体由宿主提供，中文公文的宋体/仿宋/楷体及方正字体需要真实样例验证；字体替换会影响分页，`missingFonts` 也不是完整缺字诊断。Kit 的进程/Worker 分离不等于操作系统安全沙箱。资源限制不覆盖所有原生内存和临时磁盘使用。[Node API 与限制](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/b19bb73c74ed893b8a5d1716d32df32a113ed31b/packages/entry/README.md)
- 当前 `Promise.race` 超时只结束等待，没有把取消信号传入 parser。接入 Kit 时应使用其取消/退出清理能力，维持现有文件授权和 ZIP 校验；不能把畸形文档被拒绝解释成需要无条件换引擎重试。不要默认调用 `recalculate()`，重新计算可能改变原文件缓存的公式结果。
- Kit 为 **MPL-2.0**。再分发需保留引擎与第三方许可声明、相应源码信息；若修改受 MPL 覆盖文件，还涉及对应修改源码的提供义务。它允许与其他许可证代码组合，不能简单等同于 MIT，也不能推断整个 CMspark 必须改许可证。[Mozilla MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)、[Kit 打包声明](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/b19bb73c74ed893b8a5d1716d32df32a113ed31b/docs/packaging.md)

**WPS 格式问题需要另行解决**

WPS 是生成软件，也是若干专有格式的名称。应把标准 DOCX/XLSX/PPTX 与 WPS/ET/DPS 分开统计；WPS 官方确实单独列出这些专有后缀。[WPS 官方格式说明](https://open.wps.cn/documents/app-integration-dev/docs-center/online-preview-edit/format)

部分带 WPS 后缀的文件可能实际使用兼容的标准容器。这类文件可以研究按文件签名、ZIP 部件或 OLE 流识别真实格式后适配，但仅有 OLE 头或改后缀不足以证明兼容，不能把这种有限兼容扩展成“全面支持 WPS”。真正不同的专有容器需要专用解析器或经过验证的 WPS 转换路径。

可并行纳入下一轮候选的 [Firecrawl AnyDoc](https://github.com/firecrawl/anydoc) 是直接提取 Markdown 的 Rust 库，有 Node/Python/WASM 绑定；其公开矩阵还包含 DOCM/XLSM/XLSB、PPS/POT、EPUB，许可证为 MIT。它是更贴近“扩大正文读取范围”的替代候选，但本次没有做其质量/包体/发行包验证，不能宣称优于当前 parser。社区 DeepSeek Harness 文档插件采用它，不代表它是 DeepSeek 官方引擎。

AnyDoc 的 [WPS/ET 支持 PR #48](https://github.com/firecrawl/anydoc/pull/48) 在调研时仍为 **open，未合并**；作者描述的范围是含标准内容流的部分兼容文件，也未覆盖 DPS。不能把这张 PR 当作正式发布的 WPS 支持。WPS 官方 WebOffice 虽声明支持这些后缀，其在线预览/编辑能力也不等于已经验证可返回我们需要的 Markdown；若考虑该路径，需另核对转换接口、授权和文档处理方式。

**调研建议**

保留 `officeparser` 为已有格式的正文入口，优先评估 Kit 作为旧版 Office 转换、ODP 兼容转换和页面渲染补充。ODS 可以先验证入口放行；ODP 必须把此次漏字样例纳入验证。若主要目标是大量新增可读后缀，进一步比较 AnyDoc 与当前 parser 的正文完整性和结构，而非仅比较宣传格式数。WPS/ET/DPS 需收集真实不同版本文件，作为独立兼容性问题处理。

进入实现决策前，仍需要代表性业务文件覆盖中文公文、表格多工作表/公式/合并单元格、幻灯片备注/文本框/图片、真实 WPS 专有文件、扫描及混合 PDF，并核对 Mac/Windows 发行包。验收应检查关键文本、表格数值、正文完整性和来源页/表信息，不能只看返回成功或文件生成。正式需求设计须遵循仓库 Issue-first 规则。
