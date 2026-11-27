import { execFileSync } from "node:child_process"
import { Converter } from "opencc-js"

let toSimplified: ReturnType<typeof Converter> | undefined
let toTraditional: ReturnType<typeof Converter> | undefined

let preferredLanguage: string | undefined

function computerLanguage(): string {
  if (preferredLanguage) return preferredLanguage
  let locale = Intl.DateTimeFormat().resolvedOptions().locale
  try {
    // Packaged Node can inherit a C/en_US shell locale on a Chinese desktop.
    const options = { encoding: "utf8" as const, timeout: 2500, windowsHide: true }
    if (process.platform === "darwin") {
      const languages = execFileSync("/usr/bin/defaults", ["read", "-g", "AppleLanguages"], options)
      locale = languages.match(/^\s*"?([a-z]{2,3}(?:-[A-Za-z0-9]+)*)"?[,]?\s*$/m)?.[1] ?? locale
    } else if (process.platform === "win32") {
      locale = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-UICulture).Name"], options).trim()
    }
    preferredLanguage = new Intl.Locale(locale).baseName
  } catch { preferredLanguage = Intl.DateTimeFormat().resolvedOptions().locale }
  return preferredLanguage
}

export function transcriptionLocale(selection?: string, systemLocale?: string) {
  if (selection !== "system") return selection
  const locale = new Intl.Locale(systemLocale ?? computerLanguage())
  return locale.language === "zh" ? "zh-" + locale.maximize().script : locale.language
}

/** Whisper takes a spoken language code. Chinese orthography is applied to its text. */
export function recognitionLanguage(selection?: string) {
  const locale = transcriptionLocale(selection)
  return locale?.split("-")[0]
}

export function transcriptionText(text: string, selection?: string): string {
  const locale = transcriptionLocale(selection)
  if (locale === "zh-Hans") {
    toSimplified ??= Converter({ from: "t", to: "cn" })
    return toSimplified(text)
  }
  if (locale === "zh-Hant") {
    toTraditional ??= Converter({ from: "cn", to: "t" })
    return toTraditional(text)
  }
  return text
}
