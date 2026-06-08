// Interactive settings CLI for LLM configuration
// Usage: cmspark-agent settings              → interactive mode
//        cmspark-agent settings --set key=value → non-interactive mode

import * as readline from "readline"
import { getConfig, saveConfig, DATA_DIR } from "./config"

const VALID_KEYS = ["api_key", "base_url", "model_name", "temperature", "context_window"]

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return key ? "***" : ""
  return key.slice(0, 4) + "..." + key.slice(-4)
}

function validateValue(key: string, value: string): string | null {
  switch (key) {
    case "api_key":
      if (!value || value.length < 8) return "API Key 过短"
      if (!value.startsWith("sk-")) return "API Key 应以 sk- 开头"
      return null
    case "base_url":
      try {
        new URL(value)
      } catch {
        return "无效的 URL"
      }
      return null
    case "temperature":
      {
        const n = parseFloat(value)
        if (isNaN(n) || n < 0 || n > 2) return "temperature 应为 0.0 - 2.0 之间的数字"
      }
      return null
    case "context_window":
      {
        const n = parseInt(value, 10)
        if (isNaN(n) || n < 1000 || n > 10000000) return "context_window 应为 1000 - 10000000 之间的整数"
      }
      return null
    case "model_name":
      if (!value.trim()) return "model_name 不能为空"
      return null
    default:
      return null
  }
}

function applySetting(key: string, value: string): { ok: boolean; error?: string } {
  const validationError = validateValue(key, value)
  if (validationError) return { ok: false, error: validationError }

  const config = getConfig()
  if (key === "api_key") {
    config.llm.api_key = value
  } else if (key === "base_url") {
    config.llm.base_url = value
  } else if (key === "model_name") {
    config.llm.model_name = value
  } else if (key === "temperature") {
    config.llm.temperature = parseFloat(value)
  } else if (key === "context_window") {
    config.llm.context_window = parseInt(value, 10)
  }

  saveConfig(config)
  return { ok: true }
}

export async function runInteractiveSettings(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  const config = getConfig()
  console.log("\n=== CMspark LLM 设置 ===\n")
  console.log(`  1. API Key      : ${maskApiKey(config.llm.api_key)}`)
  console.log(`  2. Base URL     : ${config.llm.base_url}`)
  console.log(`  3. Model Name   : ${config.llm.model_name}`)
  console.log(`  4. Temperature  : ${config.llm.temperature}`)
  console.log(`  5. Context Window: ${config.llm.context_window}`)
  console.log(`  0. 退出`)
  console.log("")

  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve))

  while (true) {
    const choice = await ask("请选择要修改的配置项 (0-5): ")
    const idx = parseInt(choice.trim(), 10)
    if (idx === 0) break
    if (idx < 1 || idx > 5) {
      console.log("无效选项，请重新输入")
      continue
    }

    const key = VALID_KEYS[idx - 1]
    const current =
      key === "api_key"
        ? maskApiKey(config.llm.api_key)
        : String((config.llm as any)[key])
    const value = await ask(`  当前值: ${current}\n  新值: `)
    const trimmed = value.trim()
    if (!trimmed) {
      console.log("未输入值，取消修改")
      continue
    }

    const result = applySetting(key, trimmed)
    if (result.ok) {
      console.log(`✅ ${key} 已更新`)
    } else {
      console.log(`❌ 更新失败: ${result.error}`)
    }
  }

  rl.close()
  console.log("\n设置已保存到:", DATA_DIR + "/config.json\n")
}

export function runNonInteractiveSettings(kvPairs: string[]): void {
  const results: Array<{ key: string; ok: boolean; error?: string }> = []

  for (const pair of kvPairs) {
    const eq = pair.indexOf("=")
    if (eq < 0) {
      results.push({ key: pair, ok: false, error: "格式错误，应为 key=value" })
      continue
    }
    const key = pair.slice(0, eq).trim()
    const value = pair.slice(eq + 1).trim()

    if (!VALID_KEYS.includes(key)) {
      results.push({ key, ok: false, error: `不支持的配置项，支持: ${VALID_KEYS.join(", ")}` })
      continue
    }

    results.push({ key, ...applySetting(key, value) })
  }

  for (const r of results) {
    if (r.ok) {
      console.log(`✅ ${r.key} 已更新`)
    } else {
      console.log(`❌ ${r.key}: ${r.error}`)
    }
  }
}
