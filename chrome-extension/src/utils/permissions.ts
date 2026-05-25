// Permission check helpers

export const DANGEROUS_EVALUATE_APIS = [
  "fetch(",
  "XMLHttpRequest",
  "localStorage",
  "sessionStorage",
  "document.cookie",
  "window.open",
  "navigator.sendBeacon",
]

export function detectDangerousCode(code: string): string[] {
  return DANGEROUS_EVALUATE_APIS.filter(api => code.includes(api))
}

export function hasDangerousApis(code: string): boolean {
  return detectDangerousCode(code).length > 0
}
