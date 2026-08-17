/** Fail-closed name heuristic. Does NOT read protocol. */
export function likelyMultimodal(modelName: string | undefined | null): boolean {
  const m = (modelName || "").trim().toLowerCase()
  if (!m) return false
  if (/deepseek/.test(m)) return false
  if (/\br1\b/.test(m) && !/vision|vl/.test(m)) return false
  if (/(^|[-_])(coder|reasoner)($|[-_])/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/kimi-k2/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/moonshot-v1/.test(m) && !/vl|vision|omni/.test(m)) return false
  if (/gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|o[1-9].*vision|chatgpt-4o/.test(m)) return true
  if (/claude|sonnet|opus|haiku/.test(m)) return true
  if (/gemini|gemma.*vision/.test(m)) return true
  if (/kimi|moonshot/.test(m)) return true
  if (/glm-4v|glm-4\.?\d*v|glm-4\.6v/.test(m)) return true
  if (/qwen.*vl|vl.*qwen|qwen2\.5-?vl|qwen2-vl|qwen3-vl/.test(m)) return true
  if (/llava|minicpm-v|moondream|pixtral|phi-3-vision|phi-4-multimodal/.test(m)) return true
  if (/\bvision\b|multimodal|omni/.test(m)) return true
  return false
}
