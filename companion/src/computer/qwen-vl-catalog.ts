// Qwen3-VL experimental locate layer — variant catalog + resource guidance.
// Replaces TinyClick (Florence-2 ONNX) with downloadable Qwen3-VL Instruct models
// from Hugging Face (Apache 2.0 / Qwen license terms as published on the model card).

export type QwenVlVariant = "2b" | "4b" | "8b"

export const QWEN_VL_DEFAULT_VARIANT: QwenVlVariant = "2b"

export const QWEN_VL_VARIANTS: readonly QwenVlVariant[] = ["2b", "4b", "8b"] as const

export function isQwenVlVariant(v: unknown): v is QwenVlVariant {
  return v === "2b" || v === "4b" || v === "8b"
}

/** Map legacy TinyClick variants → default Qwen3-VL size (config migration). */
export function migrateLegacyModelVariant(v: unknown): QwenVlVariant {
  if (isQwenVlVariant(v)) return v
  // hybrid / int8 / anything else → 2b default
  return QWEN_VL_DEFAULT_VARIANT
}

export interface QwenVlVariantMeta {
  variant: QwenVlVariant
  /** Hugging Face repo id */
  hfRepo: string
  /** ModelScope model id (usually same org/name as HF for Qwen) */
  modelscopeId: string
  /** Short UI label */
  label: string
  /** Approximate weight download size (GB, BF16/safetensors ballpark) */
  downloadGb: number
  /**
   * Recommended total system memory for smooth CPU / unified-memory inference
   * (Apple Silicon / no discrete GPU). Includes KV + activations headroom.
   */
  minRamGb: number
  /**
   * Recommended discrete VRAM for smooth GPU inference (CUDA / ROCm).
   * On Apple Silicon, use minRamGb as the unified-memory budget instead.
   */
  minVramGb: number
  /** One-line Chinese tip for Settings UI */
  resourceTip: string
}

/**
 * Resource numbers are conservative “smooth interactive” guidance (not hard gates).
 * Derived from community Q4/BF16 deploy notes + VLM vision overhead (~1.5–2× pure-text).
 */
export const QWEN_VL_VARIANT_META: Record<QwenVlVariant, QwenVlVariantMeta> = {
  "2b": {
    variant: "2b",
    hfRepo: "Qwen/Qwen3-VL-2B-Instruct",
    modelscopeId: "Qwen/Qwen3-VL-2B-Instruct",
    label: "Qwen3-VL-2B（默认）",
    downloadGb: 4.5,
    minRamGb: 12,
    minVramGb: 6,
    resourceTip:
      "默认推荐。流畅运行建议：统一内存/系统内存 ≥12GB，或独显显存 ≥6GB（量化后可更低）。CPU 可跑但延迟较高。",
  },
  "4b": {
    variant: "4b",
    hfRepo: "Qwen/Qwen3-VL-4B-Instruct",
    modelscopeId: "Qwen/Qwen3-VL-4B-Instruct",
    label: "Qwen3-VL-4B",
    downloadGb: 8,
    minRamGb: 20,
    minVramGb: 10,
    resourceTip:
      "能力更强。流畅运行建议：统一内存/系统内存 ≥20GB，或独显显存 ≥10GB。笔记本无独显时优先选 2B。",
  },
  "8b": {
    variant: "8b",
    hfRepo: "Qwen/Qwen3-VL-8B-Instruct",
    modelscopeId: "Qwen/Qwen3-VL-8B-Instruct",
    label: "Qwen3-VL-8B",
    downloadGb: 16,
    minRamGb: 32,
    minVramGb: 16,
    resourceTip:
      "最强本机档。流畅运行建议：统一内存/系统内存 ≥32GB，或独显显存 ≥16GB。资源不足会极慢或 OOM。",
  },
}

export function qwenVlMeta(variant: QwenVlVariant): QwenVlVariantMeta {
  return QWEN_VL_VARIANT_META[variant]
}

/** Disk dir name under ~/.cmspark-agent/models/ */
export function qwenVlDirName(variant: QwenVlVariant): string {
  return `qwen3-vl-${variant}`
}
