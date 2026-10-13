# Office compatibility fixtures (#611)

These synthetic documents contain no user information or external resources.

The DOC/XLS/PPT files are unchanged copies from DeepSeek LibreOffice Kit revision
[`b19bb73c74ed893b8a5d1716d32df32a113ed31b`](https://github.com/deepseek-ai/dsh-libreoffice-kit/tree/b19bb73c74ed893b8a5d1716d32df32a113ed31b/test/fixtures).
Upstream's [fixture description](https://github.com/deepseek-ai/dsh-libreoffice-kit/blob/b19bb73c74ed893b8a5d1716d32df32a113ed31b/test/fixtures/README.md)
documents their source, binary export filters and expected English/Chinese text.
Its complete [NOTICE](NOTICE), including DeepSeek's MIT notice for the originating
Harness fixture code, is retained here. Kit itself and its engine use MPL-2.0;
this fixture notice does not change the engine's license.

The ODS and ODP files were exported from these XLS/PPT inputs using the published
Kit 0.1.5 on macOS ARM64, Node 22.23.2, during the 2026-10-13 research.
The ODP is the regression sample whose `content.xml` and rendered image retained
`Office preview 中文文档` while officeparser 7.2.3's direct ODP Markdown omitted it.
Tests use the committed bytes instead of regenerating these samples.

| File | SHA-256 |
| --- | --- |
| one-page.doc | 2483a8cafde92910a0ea857cce49c07e6fa6bf58ab4a4f0852dfd2f488dedba1 |
| one-sheet.xls | 311df8fcb797cfeffb552f254a054976ab61611d4a2cf68cd11f3ae7e2a73d37 |
| one-slide.ppt | 1f0eb633897433cbc7cf05e7ee99f43424205dddc180aff4c58c4b18964816ce |
| one-sheet.ods | 10d559250aa9022008cc4808f7ad9cd04c69e37f00cc5ec8648fd963666b6246 |
| one-slide.odp | 84846bd209b92baf5ad00261d17a8e4171297fd7a52bcff29908ce7ba1449ca5 |

The test also generates repository-authored minimal DOCX/XLSX/ODS and PDF files with
AdmZip and a PDF object/xref writer. They exercise repeated/numeric paragraphs,
multiple sheets, positive/negative/decimal values, a stored formula result, and
eleven vector-only PDF pages. The stored XLSX formula result is checked on the
direct officeparser path; this does not assert that import/export through
LibreOffice preserves every formula cache. Synthetic success is not a promise
of complex business-document fidelity or WPS/ET/DPS support.
