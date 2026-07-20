// WP5 I2 WI-2.2 — TinyClick BPE tokenizer（JS 实现，与 HF tokenizers 零分叉锁定）。
//
// 管线（与 s1 model/tokenizer.json 声明完全一致，分布锁定）：
//   1. added_tokens 左最长匹配切出（special 段直接映射 id，不走 BPE——HF AddedVocabulary 语义）
//   2. ByteLevel pre_tokenizer（use_regex=true）：GPT-2 pattern 预分词（原串上切分）
//   3. 每个 pre-token：UTF-8 字节 → bytes_to_unicode 映射字符 → BPE merges 秩循环 → vocab 查 id
//   4. RobertaProcessing post_processor：[cls_id, ...ids, sep_id]（s1：cls=<s>=0，sep=</s>=2）
//
// 零分叉锁定：companion/tests/fixtures/tinyclick-tokenizer-vectors.json（1238 条，
// transformers 4.45.2 生成，含官方 prompt 配方/边界形态/1200 随机样本）逐条全等。
//
// 畸形防护：tokenizer.json 截断/篡改/类型错误一律结构化 TokenizerError（fail-closed），
// 不抛裸异常、不挂死。加载器对来源不可知——字节从哪来由调用方决定（bundled asset）。
//
// prompt 配方（s1/s3 官方）：("What to do to execute the command? " + command.strip()).lower()

/** tokenizer 结构化错误。code 供测试/审计断言。 */
export class TokenizerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TokenizerError";
    this.code = code;
  }
}

export interface TinyClickTokenizer {
  /** 编码为含 [0,...,2] 包装的 input_ids（与 HF tokenizer.encode 输出逐 token 全等）。 */
  encode(text: string): number[];
  /** 词表大小（含 added_tokens）。 */
  vocabSize(): number;
}

/** 官方 prompt 配方（golden_build.py:50 / ort_infer.py:52 同款，python strip == JS trim）。 */
export function buildCommandPrompt(command: string): string {
  return ("What to do to execute the command? " + command.trim()).toLowerCase();
}

// --- bytes_to_unicode（GPT-2 表，算法生成，与 transformers 同源） -------------------

/**
 * byte → 映射字符。可打印段（!-~、¡-¬、®-ÿ）恒等；其余字节按序映射到 256+n。
 * 与 GPT-2 bytes_to_unicode() 逐字节一致。
 */
function buildByteToUnicode(): string[] {
  const printable: number[] = [];
  for (let b = 0x21; b <= 0x7e; b++) printable.push(b); // ! 到 ~
  for (let b = 0xa1; b <= 0xac; b++) printable.push(b); // ¡ 到 ¬
  for (let b = 0xae; b <= 0xff; b++) printable.push(b); // ® 到 ÿ
  const keep = new Set(printable);
  const table = new Array<string>(256);
  let n = 0;
  for (let b = 0; b < 256; b++) {
    table[b] = keep.has(b) ? String.fromCharCode(b) : String.fromCharCode(256 + n++);
  }
  return table;
}

const BYTE_TO_UNICODE = buildByteToUnicode();

/**
 * GPT-2 pre-tokenizer pattern（use_regex=true 版，HF fancy-regex 原样移植为 JS /u）。
 * \p{L}/\p{N} 在 JS u 标志下同为 Unicode 属性语义。
 */
const PRE_TOKENIZE_RE =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

// --- tokenizer.json 解析（fail-closed 校验） ----------------------------------------

interface AddedToken {
  id: number;
  content: string;
}

function asRecord(v: unknown, what: string): Record<string, unknown> {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new TokenizerError("tokenizer-invalid", `${what} 应为对象`);
  }
  return v as Record<string, unknown>;
}

function parseVocab(raw: unknown): Map<string, number> {
  const obj = asRecord(raw, "model.vocab");
  const vocab = new Map<string, number>();
  for (const [token, id] of Object.entries(obj)) {
    if (typeof id !== "number" || !Number.isInteger(id) || id < 0) {
      throw new TokenizerError("tokenizer-invalid", `model.vocab["${token}"] 应为非负整数 id`);
    }
    vocab.set(token, id);
  }
  if (vocab.size === 0) {
    throw new TokenizerError("tokenizer-invalid", "model.vocab 为空");
  }
  return vocab;
}

function parseMerges(raw: unknown): Map<string, number> {
  if (!Array.isArray(raw)) {
    throw new TokenizerError("tokenizer-invalid", "model.merges 应为数组");
  }
  const ranks = new Map<string, number>();
  for (let i = 0; i < raw.length; i++) {
    const m = raw[i];
    if (typeof m !== "string") {
      throw new TokenizerError("tokenizer-invalid", `model.merges[${i}] 应为字符串`);
    }
    // 合并对不含字面空格（空格字节已映射为 Ġ），必须恰好两段
    const parts = m.split(" ");
    if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
      throw new TokenizerError("tokenizer-invalid", `model.merges[${i}] 形态非法: ${JSON.stringify(m)}`);
    }
    ranks.set(`${parts[0]}${parts[1]}`, i);
  }
  return ranks;
}

function parseAddedTokens(raw: unknown): AddedToken[] {
  if (!Array.isArray(raw)) {
    throw new TokenizerError("tokenizer-invalid", "added_tokens 应为数组");
  }
  const out: AddedToken[] = [];
  for (let i = 0; i < raw.length; i++) {
    const t = asRecord(raw[i], `added_tokens[${i}]`);
    if (typeof t.id !== "number" || !Number.isInteger(t.id) || t.id < 0) {
      throw new TokenizerError("tokenizer-invalid", `added_tokens[${i}].id 应为非负整数`);
    }
    if (typeof t.content !== "string" || t.content === "") {
      throw new TokenizerError("tokenizer-invalid", `added_tokens[${i}].content 应为非空字符串`);
    }
    out.push({ id: t.id, content: t.content });
  }
  return out;
}

/** 从 post_processor 取 cls/sep id（分布锁定：必须是 RobertaProcessing，id 取配置值不硬编码）。 */
function parseWrapIds(raw: unknown): { clsId: number; sepId: number } {
  const obj = asRecord(raw, "post_processor");
  if (obj.type !== "RobertaProcessing") {
    throw new TokenizerError(
      "tokenizer-invalid",
      `post_processor.type 应为 RobertaProcessing，实际: ${String(obj.type)}（分布锁定，拒绝静默换语义）`,
    );
  }
  const pick = (v: unknown, what: string): number => {
    if (!Array.isArray(v) || v.length !== 2 || typeof v[1] !== "number" || !Number.isInteger(v[1])) {
      throw new TokenizerError("tokenizer-invalid", `post_processor.${what} 应为 [token, id] 对`);
    }
    return v[1] as number;
  };
  return { clsId: pick(obj.cls, "cls"), sepId: pick(obj.sep, "sep") };
}

// --- BPE 核心 ------------------------------------------------------------------------

function bpeEncodeWord(word: string, ranks: Map<string, number>, vocab: Map<string, number>): number[] {
  // word 已是 bytes_to_unicode 映射字符序列
  let symbols = [...word];
  if (symbols.length === 1) {
    const id = vocab.get(symbols[0]!);
    if (id === undefined) {
      throw new TokenizerError("vocab-missing", `vocab 缺少基础字符: ${JSON.stringify(symbols[0])}`);
    }
    return [id];
  }
  // 秩循环：每轮找全词内秩最小的相邻对，整体合并，直至无可并对
  for (;;) {
    let bestRank = Infinity;
    let bestPair: string | null = null;
    for (let i = 0; i < symbols.length - 1; i++) {
      const rank = ranks.get(symbols[i]! + symbols[i + 1]!);
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank;
        bestPair = symbols[i]! + symbols[i + 1]!;
      }
    }
    if (bestPair === null) break;
    const merged: string[] = [];
    for (let i = 0; i < symbols.length; i++) {
      if (i < symbols.length - 1 && symbols[i]! + symbols[i + 1]! === bestPair) {
        merged.push(bestPair);
        i++;
      } else {
        merged.push(symbols[i]!);
      }
    }
    symbols = merged;
    if (symbols.length === 1) break;
  }
  return symbols.map((s) => {
    const id = vocab.get(s);
    if (id === undefined) {
      throw new TokenizerError("vocab-missing", `vocab 缺少合并符号: ${JSON.stringify(s)}`);
    }
    return id;
  });
}

// --- 加载入口 -------------------------------------------------------------------------

/**
 * 从 tokenizer.json 文本构建 tokenizer。任何畸形（截断 JSON、类型错误、非法
 * merges/added_tokens/post_processor）→ TokenizerError("tokenizer-invalid")。
 */
export function loadTokenizerFromJson(rawJson: string): TinyClickTokenizer {
  let root: Record<string, unknown>;
  try {
    root = asRecord(JSON.parse(rawJson), "tokenizer.json");
  } catch (err) {
    if (err instanceof TokenizerError) throw err;
    throw new TokenizerError(
      "tokenizer-invalid",
      `tokenizer.json 不是合法 JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // pre_tokenizer 分布锁定：ByteLevel（use_regex 语义即本模块实现）
  const preTok = asRecord(root.pre_tokenizer, "pre_tokenizer");
  if (preTok.type !== "ByteLevel") {
    throw new TokenizerError(
      "tokenizer-invalid",
      `pre_tokenizer.type 应为 ByteLevel，实际: ${String(preTok.type)}（分布锁定，拒绝静默换语义）`,
    );
  }

  const model = asRecord(root.model, "model");
  if (model.type !== "BPE") {
    throw new TokenizerError("tokenizer-invalid", `model.type 应为 BPE，实际: ${String(model.type)}`);
  }
  const vocab = parseVocab(model.vocab);
  const ranks = parseMerges(model.merges);
  const added = parseAddedTokens(root.added_tokens);
  const { clsId, sepId } = parseWrapIds(root.post_processor);

  // added_tokens 左最长匹配：按内容长度降序排序（同长字典序稳定）
  const sortedAdded = [...added].sort(
    (a, b) => b.content.length - a.content.length || (a.content < b.content ? -1 : 1),
  );
  const addedByContent = new Map(sortedAdded.map((t) => [t.content, t.id]));
  const addedFirstChar = new Set([...addedByContent.keys()].map((c) => c[0]!));

  const encoder = new TextEncoder();

  function encodePlainSegment(segment: string): number[] {
    const ids: number[] = [];
    PRE_TOKENIZE_RE.lastIndex = 0;
    for (const match of segment.matchAll(PRE_TOKENIZE_RE)) {
      const preToken = match[0];
      // UTF-8 字节 → bytes_to_unicode 映射字符
      const bytes = encoder.encode(preToken);
      let word = "";
      for (const b of bytes) word += BYTE_TO_UNICODE[b]!;
      for (const id of bpeEncodeWord(word, ranks, vocab)) ids.push(id);
    }
    return ids;
  }

  return {
    encode(text: string): number[] {
      if (typeof text !== "string") {
        throw new TokenizerError("input-invalid", `encode 输入应为字符串，实际: ${typeof text}`);
      }
      const body: number[] = [];
      let plainStart = 0;
      let i = 0;
      const flushPlain = (end: number): void => {
        if (end > plainStart) {
          for (const id of encodePlainSegment(text.slice(plainStart, end))) body.push(id);
        }
      };
      // added_tokens 左最长扫描（首字符预筛，避免全表尝试）
      while (i < text.length) {
        if (addedFirstChar.has(text[i]!)) {
          let hit: AddedToken | null = null;
          for (const t of sortedAdded) {
            if (t.content[0] === text[i] && text.startsWith(t.content, i)) {
              hit = t;
              break; // sortedAdded 已按长度降序，首中即最长
            }
          }
          if (hit) {
            flushPlain(i);
            body.push(hit.id);
            i += hit.content.length;
            plainStart = i;
            continue;
          }
        }
        i++;
      }
      flushPlain(text.length);
      return [clsId, ...body, sepId];
    },
    vocabSize(): number {
      let max = -1;
      for (const id of vocab.values()) if (id > max) max = id;
      for (const t of added) if (t.id > max) max = t.id;
      return max + 1;
    },
  };
}
