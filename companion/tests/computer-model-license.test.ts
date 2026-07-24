// WP5 I1 WI-1.3 — model-license 许可证门文案测试。
// 覆盖：双引要素（原始 LICENSE 版权行 + 论文 Ethics 引文）、Limitations 免责
// 要点、实测数字披露（S-3 冻结数据）、L2 补充条款、THIRD_PARTY_NOTICES 文件
// 与 TS 常量逐字节一致（单一真源防漂移）、MIT 全文关键条文。

import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"

import {
  FLORENCE2_MIT_FULL_TEXT,
  LICENSE_DOOR_TEXT,
  MICROSOFT_COPYRIGHT_LINE,
  SAMSUNG_COPYRIGHT_LINE,
  THIRD_PARTY_NOTICES_TEXT,
  TINYCLICK_MIT_FULL_TEXT,
} from "../src/computer/model-license"

// --- MIT 全文 ------------------------------------------------------------------

test("MIT 全文：Samsung 版含版权行与全部关键条文", () => {
  assert.ok(TINYCLICK_MIT_FULL_TEXT.includes("MIT License"))
  assert.ok(TINYCLICK_MIT_FULL_TEXT.includes(SAMSUNG_COPYRIGHT_LINE))
  assert.ok(TINYCLICK_MIT_FULL_TEXT.includes("Permission is hereby granted, free of charge"))
  assert.ok(TINYCLICK_MIT_FULL_TEXT.includes("The above copyright notice and this permission notice shall be included"))
  assert.ok(TINYCLICK_MIT_FULL_TEXT.includes('THE SOFTWARE IS PROVIDED "AS IS"'))
})

test("MIT 全文：Florence-2 版含 Microsoft 版权行", () => {
  assert.ok(FLORENCE2_MIT_FULL_TEXT.includes(MICROSOFT_COPYRIGHT_LINE))
  assert.ok(FLORENCE2_MIT_FULL_TEXT.includes("Permission is hereby granted, free of charge"))
})

// --- 许可证门文案：双引纪律（W3 §5.4） -------------------------------------------

test("license 门文案：MIT 声明双引（原始 LICENSE 文件 + 论文 Ethics 节）", () => {
  // 引源一：原始 LICENSE 文件版权行
  assert.ok(LICENSE_DOOR_TEXT.includes(SAMSUNG_COPYRIGHT_LINE))
  assert.ok(LICENSE_DOOR_TEXT.includes("原始 LICENSE 文件"))
  // 引源二：论文 Ethics 节直接引文（含出处）
  assert.ok(LICENSE_DOOR_TEXT.includes("arXiv:2410.11871"))
  assert.ok(LICENSE_DOOR_TEXT.includes("model checkpoint and code accessible under the MIT license"))
  // 底座 Florence-2 双引要素
  assert.ok(LICENSE_DOOR_TEXT.includes("microsoft/Florence-2-base"))
  assert.ok(LICENSE_DOOR_TEXT.includes("Florence2 model is available"))
})

test("license 门文案：Limitations/Ethics 免责三要点（受控环境/风险敏感/准确率下降）", () => {
  assert.ok(LICENSE_DOOR_TEXT.includes("准确率可能显著下降"))
  assert.ok(LICENSE_DOOR_TEXT.includes("controlled environment"))
  assert.ok(LICENSE_DOOR_TEXT.includes("strictly avoided"))
  // 训练数据 research-use 余量未闭合的诚实披露（O-1 挂起项）
  assert.ok(LICENSE_DOOR_TEXT.includes("explicitly allow research use"))
})

test("license 门文案：实测数字披露（S-3 冻结数据，禁乐观措辞）", () => {
  assert.ok(LICENSE_DOOR_TEXT.includes("13.3%")) // zh 含巧合
  assert.ok(LICENSE_DOOR_TEXT.includes("0/5")) // 真实桌面/设置
  assert.ok(LICENSE_DOOR_TEXT.includes("2.8")) // 4 核延迟区间
  assert.ok(LICENSE_DOOR_TEXT.includes("英文短命令"))
  assert.ok(LICENSE_DOOR_TEXT.includes("可选实验层"))
  assert.ok(LICENSE_DOOR_TEXT.includes("默认关闭"))
})

test("license 门文案：L2 补充条款 + 完整性≠来源诚实声明 + 拒绝语义", () => {
  assert.ok(LICENSE_DOOR_TEXT.includes("任何点击执行前必经 L2 人工确认"))
  assert.ok(LICENSE_DOOR_TEXT.includes("不证明镜像字节与 Samsung 原始权重一致"))
  assert.ok(LICENSE_DOOR_TEXT.includes("拒绝则本实验层永久跳过"))
  assert.ok(LICENSE_DOOR_TEXT.includes("其余定位层不受影响"))
})

// --- THIRD_PARTY_NOTICES（W3 §5.5） ---------------------------------------------

test("THIRD_PARTY_NOTICES：含 Samsung/Florence-2 双方 MIT 全文与版权行", () => {
  assert.ok(THIRD_PARTY_NOTICES_TEXT.includes(SAMSUNG_COPYRIGHT_LINE))
  assert.ok(THIRD_PARTY_NOTICES_TEXT.includes(MICROSOFT_COPYRIGHT_LINE))
  assert.ok(THIRD_PARTY_NOTICES_TEXT.includes("Krystianz/TinyClick"))
  assert.ok(THIRD_PARTY_NOTICES_TEXT.includes("0e1356f0b7cfb416099207121f6a766818ab8a66"))
  assert.ok(THIRD_PARTY_NOTICES_TEXT.includes("microsoft/Florence-2-base"))
  // 两份 MIT 全文都在（permission notice 出现两次）
  const occurrences = THIRD_PARTY_NOTICES_TEXT.split("Permission is hereby granted, free of charge").length - 1
  assert.strictEqual(occurrences, 2)
})

test("THIRD_PARTY_NOTICES：companion/ 下文件与 TS 常量逐字节一致（单一真源防漂移）", () => {
  const noticePath = path.join(__dirname, "..", "..", "THIRD_PARTY_NOTICES")
  const onDisk = readFileSync(noticePath, "utf-8")
  assert.strictEqual(onDisk, THIRD_PARTY_NOTICES_TEXT)
})
