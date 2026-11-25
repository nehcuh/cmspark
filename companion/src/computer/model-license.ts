// Experimental model layer license door + THIRD_PARTY_NOTICES (Qwen3-VL).
//
// LICENSE_DOOR_TEXT is shown on first enable; hash binds acceptance to text version.
// THIRD_PARTY_NOTICES_TEXT is the ship notice source of truth (keep companion/THIRD_PARTY_NOTICES in sync).

import { createHash } from "node:crypto"

// --- THIRD_PARTY_NOTICES（随分发包） --------------------------------------------

export const THIRD_PARTY_NOTICES_TEXT = `THIRD_PARTY_NOTICES — CMspark Agent
================================================================================

本分发物支持由用户显式下载以下第三方模型工件（模型文件不随安装包分发，
下载前须经许可证门确认）。

--------------------------------------------------------------------------------
1. Qwen3-VL Instruct（工作中心本机图像处理）
--------------------------------------------------------------------------------
Source:   https://huggingface.co/Qwen
Variants: Qwen3-VL-2B / 4B / 8B Instruct
License:  以各模型卡与 Qwen 许可条款为准（请以 Hugging Face 页面最新 LICENSE 为准）
Notes:    用于从用户选择的工作中心图片中提取文字和待办。

--------------------------------------------------------------------------------
2. Cairn (protocol inspiration only — NOT linked, NOT redistributed)
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

// --- 许可证门弹窗文案（computer.model.license_required 的 licenseText） ---

export const LICENSE_DOOR_TEXT = `工作中心本机图像模型许可

工作中心可用 Qwen3-VL Instruct 在本机从图片提取文字和待办。请核对模型提取的内容。

模型源与许可
- Qwen/Qwen3-VL-2B-Instruct、4B-Instruct、8B-Instruct。权重许可见 Hugging Face 上对应模型卡和 LICENSE。
- 接受后，Companion 会按所选来源和规模下载模型。本机推理使用 Python、transformers 和 torch。下载体积约 4.5 GB（2B）、8 GB（4B）或 16 GB（8B）。

拒绝会跳过模型下载。可在设置页复位拒绝，重新查看许可。`

/** LICENSE_DOOR_TEXT 的 sha256 前 12 位小写 hex（config normalize 同形状校验）。 */
export const LICENSE_DOOR_TEXT_HASH = createHash("sha256")
  .update(LICENSE_DOOR_TEXT, "utf8")
  .digest("hex")
  .slice(0, 12)
