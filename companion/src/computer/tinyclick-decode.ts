// WP5 I2 — TinyClick 贪心解码纯函数（worker 内会话循环与单测共用）。
//
// 输出结构事实（spike 冻结）：生成序列恒 ~7 token——[2(起始), 0(<s>), "click",
// 可选宾语 token, <loc_x>, <loc_y>, 2(EOS)]；全前缀重算贪心（无 KV cache，~7 步
// 代价可忽略，W2 实测 decoder ≈6% e2e）。步数上限 50 只是失控保险。

/** </s>：decoder 起始 token 与终止 token 同 id（BART/Florence-2 惯例）。 */
export const EOS_ID = 2
export const DECODER_START_ID = 2
/** 贪心循环硬上限（失控保险；正常输出 5-7 步）。 */
export const MAX_DECODE_STEPS = 50
/** logits 词表大小（4 图导出形状）。 */
export const VOCAB_SIZE = 51289
/** <loc_0> 的 token id（added_tokens 段：基词表 50265 + 4 保留位；<loc_N> = LOC_TOKEN_BASE + N，
 *  N∈[0,999]，<loc_999>=51268。实测核验：s1 reference 50551/50797 ↔ loc 282/528）。 */
export const LOC_TOKEN_BASE = 50269

/** 末位 logits 的 argmax（全词表线性扫描，~51k 次比较 ≈ 可忽略）。 */
export function argmaxLast(
  logits: Float32Array | number[],
  position: number,
  vocabSize: number = VOCAB_SIZE,
): number {
  const off = position * vocabSize
  let best = 0
  let bestV = -Infinity
  for (let i = 0; i < vocabSize; i++) {
    const v = logits[off + i]!
    if (v > bestV) {
      bestV = v
      best = i
    }
  }
  return best
}

/**
 * 贪心解码循环驱动。runStep(prefixIds) 返回当前前缀下完整 logits（全前缀重算），
 * 本函数取末位 argmax 续写，遇 EOS 或步数上限终止。返回含起始 id 的完整序列。
 */
export async function greedyDecode(
  runStep: (prefixIds: number[]) => Promise<Float32Array | number[]>,
  opts: { maxSteps?: number; vocabSize?: number } = {},
): Promise<number[]> {
  const maxSteps = opts.maxSteps ?? MAX_DECODE_STEPS
  const vocabSize = opts.vocabSize ?? VOCAB_SIZE
  const out = [DECODER_START_ID]
  while (out.length - 1 < maxSteps) {
    const logits = await runStep(out)
    const best = argmaxLast(logits, out.length - 1, vocabSize)
    out.push(best)
    if (best === EOS_ID) break
  }
  return out
}

/**
 * 从生成序列解析 <loc_N> bin：收集全部 loc token（同 s3-run.js idsToPoint 语义——
 * ≥2 取前两个；<2 返回 null）。非坐标输出为诚实失败（null），调用方不得编造坐标。
 */
export function parseLocBins(tokenIds: number[]): [number, number] | null {
  const vals = tokenIds
    .filter((i) => i >= LOC_TOKEN_BASE && i < LOC_TOKEN_BASE + 1000)
    .map((i) => i - LOC_TOKEN_BASE)
  if (vals.length < 2) return null
  return [vals[0]!, vals[1]!]
}
