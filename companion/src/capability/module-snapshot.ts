import { types } from "node:util"
import { getConfigSnapshot, type CompanionConfig } from "../config"

const MAX_DEPTH = 64
const MAX_NODES = 1_000_000
const MAX_ARRAY_LENGTH = 1_000_000
const MAX_STRING_LENGTH = 16 * 1024 * 1024
const MAX_TOTAL_STRING_LENGTH = 64 * 1024 * 1024

type Modules = NonNullable<CompanionConfig["modules"]>

export type ModulesConfigSnapshot = {
  revision: string
  capability_profile: "community" | "enterprise"
  modules: Modules
}

type CopyBudget = { nodes: number; stringLength: number }

function invalid(): never {
  throw new Error("MODULE_SNAPSHOT_INVALID")
}

function ownData(value: object, key: string): unknown {
  if (types.isProxy(value)) invalid()
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (!descriptor) return undefined
  if (!descriptor.enumerable || !("value" in descriptor)) invalid()
  return descriptor.value
}

function countNode(budget: CopyBudget): void {
  budget.nodes += 1
  if (budget.nodes > MAX_NODES) invalid()
}

function countString(value: string, budget: CopyBudget): void {
  if (value.length > MAX_STRING_LENGTH) invalid()
  budget.stringLength += value.length
  if (budget.stringLength > MAX_TOTAL_STRING_LENGTH) invalid()
}

function maskToJSON(value: object): void {
  Object.defineProperty(value, "toJSON", {
    value: undefined,
    enumerable: false,
    writable: false,
    configurable: false,
  })
}

function copyJson(value: unknown, depth: number, budget: CopyBudget, ancestors: WeakSet<object>): unknown {
  countNode(budget)
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid()
    return value
  }
  if (typeof value === "string") {
    countString(value, budget)
    return value
  }
  if (!value || typeof value !== "object" || types.isProxy(value)) invalid()
  if (depth > MAX_DEPTH || ancestors.has(value)) invalid()

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) invalid()
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length")
      if (!lengthDescriptor || !("value" in lengthDescriptor)) invalid()
      const length = lengthDescriptor.value
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_ARRAY_LENGTH) invalid()
      if (Reflect.ownKeys(value).length !== length + 1) invalid()
      const result = new Array(length)
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid()
        Object.defineProperty(result, String(index), {
          value: copyJson(descriptor.value, depth + 1, budget, ancestors),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
      maskToJSON(result)
      return result
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype) invalid()
    const result: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || key === "toJSON") invalid()
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) invalid()
      countString(key, budget)
      Object.defineProperty(result, key, {
        value: copyJson(descriptor.value, depth + 1, budget, ancestors),
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    maskToJSON(result)
    return result
  } finally {
    ancestors.delete(value)
  }
}

export function copyModulesConfigSnapshot(snapshot: {
  config: CompanionConfig
  revision: string
}): ModulesConfigSnapshot {
  if (!snapshot.config || typeof snapshot.config !== "object" || types.isProxy(snapshot.config)) invalid()
  const modules = ownData(snapshot.config, "modules")
  if (modules !== undefined && (modules === null || typeof modules !== "object" || Array.isArray(modules))) invalid()
  const profile = ownData(snapshot.config, "capability_profile")
  if (profile !== "community" && profile !== "enterprise") invalid()
  return {
    revision: snapshot.revision,
    capability_profile: profile,
    modules: copyJson(modules === undefined ? {} : modules, 0, { nodes: 0, stringLength: 0 }, new WeakSet()) as Modules,
  }
}

export function getModulesConfigSnapshot(): ModulesConfigSnapshot {
  const before = getConfigSnapshot()
  const snapshot = copyModulesConfigSnapshot(before)
  const after = getConfigSnapshot()
  if (before.revision !== after.revision || before.config !== after.config) invalid()
  return snapshot
}
