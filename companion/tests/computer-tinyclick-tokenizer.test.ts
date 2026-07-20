// WP5 I2 WI-2.2 — TinyClick BPE tokenizer 测试。
// 零分叉锁定：1238 条 HF 参考向量逐条全等（官方配方/边界形态/1200 随机样本）；
// s1 官方 input_text 的 15 token 精确序列；special token 切出；畸形 fuzz 结构化失败。

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildCommandPrompt,
  loadTokenizerFromJson,
  TokenizerError,
} from "../src/computer/tinyclick-tokenizer";

// 路径纪律（同 computer-input-ps1.test.ts 惯例）：.test-dist/tests → companion/ 根
const COMPANION_ROOT = path.resolve(__dirname, "..", "..");
const TOKENIZER_JSON = readFileSync(
  path.join(COMPANION_ROOT, "assets", "tinyclick", "tokenizer.json"),
  "utf-8",
);
const VECTORS = JSON.parse(
  readFileSync(
    path.join(COMPANION_ROOT, "tests", "fixtures", "tinyclick-tokenizer-vectors.json"),
    "utf-8",
  ),
) as { cases: Array<{ text: string; ids: number[] }> };

const tokenizer = loadTokenizerFromJson(TOKENIZER_JSON);

// --- 零分叉锁定 -------------------------------------------------------------------

test("参考向量: 1238 条 HF 编码逐条全等（含 [0,...,2] 包装）", () => {
  assert.ok(VECTORS.cases.length >= 1200, `向量数不足: ${VECTORS.cases.length}`);
  for (let i = 0; i < VECTORS.cases.length; i++) {
    const c = VECTORS.cases[i]!;
    const got = tokenizer.encode(c.text);
    assert.deepStrictEqual(
      got,
      c.ids,
      `case#${i} 分叉: text=${JSON.stringify(c.text.slice(0, 60))}`,
    );
  }
});

test("s1 官方 input_text → 15 token 精确序列（w2-worker.js:135 硬编码同款）", () => {
  const ids = tokenizer.encode("what to do to execute the command? click on the ok button");
  assert.deepStrictEqual(
    ids,
    [0, 12196, 7, 109, 7, 11189, 5, 5936, 116, 3753, 15, 5, 15983, 6148, 2],
  );
});

test("prompt 配方: 官方模板 + strip + lower（golden_build.py:50 同款）", () => {
  const prompt = buildCommandPrompt("  Click on the OK button  ");
  assert.strictEqual(prompt, "what to do to execute the command? click on the ok button");
  // 经配方后的编码 == s1 参考序列
  assert.deepStrictEqual(
    tokenizer.encode(prompt),
    [0, 12196, 7, 109, 7, 11189, 5, 5936, 116, 3753, 15, 5, 15983, 6148, 2],
  );
});

// --- special token 语义 -------------------------------------------------------------

test("added_tokens: 左最长匹配切出，special 段不重编码", () => {
  // <loc_282> = LOC_TOKEN_BASE(50269) + 282 = 50551（实测核验值）
  assert.deepStrictEqual(tokenizer.encode("<loc_282>"), [0, 50551, 2]);
  // 普通文本夹 special：前后段各自走 BPE
  const ids = tokenizer.encode("a<loc_5>b");
  assert.strictEqual(ids[0], 0);
  assert.strictEqual(ids.at(-1), 2);
  assert.ok(ids.includes(50269 + 5), "中段应为 <loc_5> 直接映射");
  // 词表大小 = 51289（4 图导出形状，decode VOCAB_SIZE 同源）
  assert.strictEqual(tokenizer.vocabSize(), 51289);
});

test("边界: 空串 → [0,2]；纯空白按 ByteLevel 语义编码", () => {
  assert.deepStrictEqual(tokenizer.encode(""), [0, 2]);
  const space = tokenizer.encode(" ");
  assert.strictEqual(space[0], 0);
  assert.strictEqual(space.at(-1), 2);
  assert.strictEqual(space.length, 3, "单个空格应恰一个 BPE token（Ġ）");
});

// --- 畸形 fuzz（fail-closed，结构化不崩不挂） -----------------------------------------

function expectTokenizerError(raw: string, what: string): void {
  assert.throws(
    () => loadTokenizerFromJson(raw),
    (err: unknown) => {
      assert.ok(err instanceof TokenizerError, `${what}: 应为 TokenizerError，实际 ${String(err)}`);
      assert.strictEqual(err.code, "tokenizer-invalid", `${what}: code 应为 tokenizer-invalid`);
      return true;
    },
    what,
  );
}

test("fuzz: 截断 JSON 全部前缀安全失败", () => {
  // 取若干代表性前缀（含 vocab/merges 中段截断）
  const n = TOKENIZER_JSON.length;
  for (const at of [0, 1, 100, 4096, n >> 2, n >> 1, (n * 3) >> 2, n - 2]) {
    expectTokenizerError(TOKENIZER_JSON.slice(0, at), `截断@${at}`);
  }
});

test("fuzz: 篡改字段类型/结构 → tokenizer-invalid", () => {
  const tamper = (fn: (root: Record<string, unknown>) => void): string => {
    const root = JSON.parse(TOKENIZER_JSON) as Record<string, unknown>;
    fn(root);
    return JSON.stringify(root);
  };
  // merges 元素非字符串
  expectTokenizerError(
    tamper((r) => {
      (r.model as Record<string, unknown>).merges = [{ bad: 1 }];
    }),
    "merges 对象元素",
  );
  // merges 三段形态
  expectTokenizerError(
    tamper((r) => {
      (r.model as Record<string, unknown>).merges = ["a b c"];
    }),
    "merges 三段",
  );
  // vocab id 非整数
  expectTokenizerError(
    tamper((r) => {
      ((r.model as Record<string, unknown>).vocab as Record<string, unknown>)["<s>"] = "zero";
    }),
    "vocab 字符串 id",
  );
  // added_tokens 缺 content
  expectTokenizerError(
    tamper((r) => {
      r.added_tokens = [{ id: 0 }];
    }),
    "added_tokens 缺 content",
  );
  // post_processor 类型篡改（分布锁定）
  expectTokenizerError(
    tamper((r) => {
      r.post_processor = { type: "TemplateProcessing" };
    }),
    "post_processor 类型",
  );
  // pre_tokenizer 类型篡改（分布锁定）
  expectTokenizerError(
    tamper((r) => {
      r.pre_tokenizer = { type: "Whitespace" };
    }),
    "pre_tokenizer 类型",
  );
  // model.type 篡改
  expectTokenizerError(
    tamper((r) => {
      (r.model as Record<string, unknown>).type = "WordPiece";
    }),
    "model.type",
  );
  // root 非对象
  expectTokenizerError("[1,2,3]", "root 数组");
  expectTokenizerError('"just a string"', "root 字符串");
  expectTokenizerError("not json at all", "裸文本");
});

test("fuzz: 非字符串输入 → input-invalid（不崩）", () => {
  assert.throws(
    () => tokenizer.encode(42 as unknown as string),
    (err: unknown) => err instanceof TokenizerError && err.code === "input-invalid",
  );
});
