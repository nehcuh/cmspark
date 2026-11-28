/** Keys reserved by the JavaScript object prototype in persisted and incoming records. */
export function isPrototypePollutionKey(key: string): boolean {
  return key === "__proto__" || key === "constructor" || key === "prototype"
}

/** Inspect own enumerable keys throughout a JSON value, including objects inside arrays. */
export function hasPrototypePollutionKey(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return Object.keys(record).some(key => isPrototypePollutionKey(key) || hasPrototypePollutionKey(record[key]))
}
