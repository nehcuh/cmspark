// WP5 I1 WI-1.3 — TinyClick 许可证门文案 + THIRD_PARTY_NOTICES 单一真源。
//
// 双引纪律（W3 §5.4 / spike 对抗:95）：license 门文案的 MIT 声明必须双引
// 「原始 LICENSE 文件 + 论文 Ethics 节」，不再单引「论文自述」；Limitations/
// Ethics 免责为原文要点转述（直接引文以引号+出处标注，转述不挂引号——诚实
// 排版）。实测数字披露遵守 plan:460/500（S-3 冻结数据，禁止乐观措辞）。
//
// 单一真源：本文件的 THIRD_PARTY_NOTICES_TEXT 常量是分发包 notice 的唯一来源；
// companion/THIRD_PARTY_NOTICES 文件内容必须与之逐字节一致（测试强制防漂移）。
// 修改文案 = 改本文件 + 同步重写 notice 文件（scripts 或手工），测试会拦住漂移。

import { createHash } from "node:crypto"

// --- MIT 全文（标准文本，版权行按方替换） --------------------------------------

function mitFullText(copyrightLine: string): string {
  return `MIT License

${copyrightLine}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`
}

export const SAMSUNG_COPYRIGHT_LINE = "Copyright (c) 2024 Samsung R&D Poland"
export const MICROSOFT_COPYRIGHT_LINE = "Copyright (c) Microsoft Corporation."

export const TINYCLICK_MIT_FULL_TEXT = mitFullText(SAMSUNG_COPYRIGHT_LINE)
export const FLORENCE2_MIT_FULL_TEXT = mitFullText(MICROSOFT_COPYRIGHT_LINE)

// --- THIRD_PARTY_NOTICES（随分发包；W3 §5.5 执行项） ----------------------------

export const THIRD_PARTY_NOTICES_TEXT = `THIRD_PARTY_NOTICES — CMspark Agent（WP5 本地模型层）
================================================================================

本分发物支持由用户显式下载以下第三方模型工件（模型文件不随安装包分发，
下载前须经许可证门确认；工件 sha256 已钉死于 companion/models.manifest.json）。

--------------------------------------------------------------------------------
1. TinyClick（ONNX 转换工件；衍生自 Krystianz/TinyClick 镜像）
--------------------------------------------------------------------------------
Source:   https://huggingface.co/Krystianz/TinyClick
Revision: 0e1356f0b7cfb416099207121f6a766818ab8a66
Paper:    arXiv:2410.11871 "TinyClick: Single-Turn Agent for Empowering GUI
          Automation" (Samsung R&D Poland)
License:  MIT — 四方一致：原始代码仓 LICENSE 文件（字节级核实）、论文
          Ethics 节（"model checkpoint and code accessible under the MIT
          license"）、镜像 YAML、作者 HF 卡。

${TINYCLICK_MIT_FULL_TEXT}

--------------------------------------------------------------------------------
2. Florence-2 底座（TinyClick 的 base model：microsoft/Florence-2-base）
--------------------------------------------------------------------------------
Source:   https://huggingface.co/microsoft/Florence-2-base
License:  MIT（TinyClick 论文 Ethics 节： "Florence2 model is available
          under MIT license"）

${FLORENCE2_MIT_FULL_TEXT}

--------------------------------------------------------------------------------
3. Cairn (protocol inspiration only — NOT linked, NOT redistributed)
--------------------------------------------------------------------------------
Project:  https://github.com/oritera/Cairn
License:  AGPL-3.0
Status:   NOT a dependency. NOT vendored. NOT copied.

CMspark MissionBoard (ADR-016) is inspired by high-level protocol ideas from
Cairn (Fact/Intent/Hint coordination, structured handback, conditional complete,
stigmergy). Schema types, runtime code, and persistence are reimplemented
independently for CMspark’s Thread / Mission Pack / multi-agent stack.

See: docs/licenses/cairn-inspiration.md
     docs/adr/016-mission-board.md §2.7 / Appendix A G14

FORBIDDEN: copying Cairn source files, pasting schema JSON verbatim, or adding
Cairn as an npm/git dependency.
`

// --- 许可证门弹窗文案（WI-3.4 computer.model.license_required 的 licenseText） ---

export const LICENSE_DOOR_TEXT = `【实验功能许可确认】Qwen3-VL 本地视觉定位模型

一、许可证与来源

本实验层默认使用阿里通义开源的 Qwen3-VL Instruct 权重（Hugging Face）：
- Qwen/Qwen3-VL-2B-Instruct（默认）
- Qwen/Qwen3-VL-4B-Instruct
- Qwen/Qwen3-VL-8B-Instruct
权重许可以各模型卡与 Qwen 许可条款为准（通常允许研究与商业使用，
请以 Hugging Face 页面最新 LICENSE 为准）。下载即表示你接受上游许可。

二、能力与限制（诚实披露）

- 本层用于「截屏 + 自然语言 → 建议点击坐标」，支持中文指令。
- 输出未校准：坐标可能完全错误；任何注入前必经确认台人工确认。
- 本机推理依赖 Python 3 + transformers/torch（或兼容后端）；首次下载体积约
  4.5GB（2B）/ 8GB（4B）/ 16GB（8B），并占用相应内存或显存。
- 资源不足时会极慢或 OOM——设置页会提示各变体建议内存/显存。

三、本项目补充条款

- 本层默认关闭；开启后为可选实验层。
- 模型建议点仅作候选；UIA / OCR / 用户框选仍为默认定位路径。
- 拒绝本许可则本实验层永久跳过（复位 = 手改 config.json）。
- 启用本层不降低其他安全门（任务级 L2、急停、白名单等）。
- 模型输出仅作为坐标解析候选，任何点击执行前必经 L2 人工确认。

接受后将按当前选择的变体从 Hugging Face 下载模型。
拒绝则本实验层永久跳过，其余定位层不受影响。`

// --- 文本版本绑定哈希（WP5-I4 P1） -------------------------------------------------
//
// 接受记录绑定文本版本：license_response 接受时把本哈希写进
// config.modelLicenseAcceptedTextHash；文本漂移（文案修订/篡改）→ 哈希不符 →
// enable/admission 重新弹门（旧接受不得对新文本默示生效）。sha256 前 12 位足够
// 区分版本（非密码学校验，是版本指纹）。

/** LICENSE_DOOR_TEXT 的 sha256 前 12 位小写 hex（config normalize 同形状校验）。 */
export const LICENSE_DOOR_TEXT_HASH = createHash("sha256")
  .update(LICENSE_DOOR_TEXT, "utf8")
  .digest("hex")
  .slice(0, 12)

