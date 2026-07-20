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
`

// --- 许可证门弹窗文案（WI-3.4 computer.model.license_required 的 licenseText） ---

export const LICENSE_DOOR_TEXT = `【实验功能许可确认】TinyClick 本地视觉定位模型

一、许可证（双引来源：原始 LICENSE 文件 + 论文 Ethics 节）

TinyClick 模型以 MIT 许可证发布：
- 原始 LICENSE 文件：「MIT License — ${SAMSUNG_COPYRIGHT_LINE}」
- 论文 Ethics 节（arXiv:2410.11871）明示：
  "We have made our model checkpoint and code accessible under the MIT license"
- 底座模型 microsoft/Florence-2-base 同为 MIT：
  "Florence2 model is available under MIT license"
（MIT 全文随分发物收录于 THIRD_PARTY_NOTICES。）

二、研究品免责声明（论文 Limitations / Ethics 要点）

- 本模型是研究工件，在新应用上的准确率可能显著下降。
- 论文建议仅在受控环境中测试："test the model only on emulator …
  controlled environment"。
- 风险敏感应用应严格避免："risk-sensitive application … strictly avoided"。
- 训练数据集的许可证措辞为 "explicitly allow research use"——商用再分发
  余量未闭合；本功能仅以用户显式下载方式提供转换工件，介意者请拒绝。

三、本项目实测披露（S-3 golden 冻结数据，2026-07-20）

- 中文命令命中率 13.3%（含巧合成分）——本层仅限英文短命令。
- 真实桌面 / 设置窗口 case 0/5 未命中（Wilson 上界 29.9%）。
- 4 核 CPU 端到端延迟 2.8–3.3 秒。
- 本层为「可选实验层」：默认关闭；拒绝或关闭后，定位兜底仍为
  UIA / OCR / 用户框选，不受影响。

四、本项目补充条款

- 模型输出仅作为坐标解析候选，任何点击执行前必经 L2 人工确认。
- 模型文件 sha256 钉死、每次加载前复验；完整性校验证明下载字节与登记字节一致，
  但不证明镜像字节与 Samsung 原始权重一致（权重无字节级第二源）。

接受后将开始下载模型文件（约 705MB，磁盘预算可配）。
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

