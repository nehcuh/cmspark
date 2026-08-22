export const BROWSER_UNAVAILABLE = "BROWSER_UNAVAILABLE" as const

export function browserUnavailableResult(): {
  success: false
  error: string
  error_code: typeof BROWSER_UNAVAILABLE
} {
  return {
    success: false,
    error_code: BROWSER_UNAVAILABLE,
    error: "BROWSER_UNAVAILABLE: Chrome extension peer missing",
  }
}
