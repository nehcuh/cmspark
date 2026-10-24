declare module "node:test" {
  type TestFn = (name: string, fn: () => void | Promise<void>) => void
  const test: TestFn
  export default test
}

declare module "node:timers" {
  export function setImmediate(callback: () => void): unknown
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string
  export function existsSync(path: string): boolean
  export function readdirSync(path: string): string[]
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean }
}

declare module "node:path" {
  export function join(...parts: string[]): string
  export function resolve(...parts: string[]): string
  export function basename(path: string, suffix?: string): string
  export function dirname(path: string): string
}

declare module "node:module" {
  export function createRequire(filename: string | URL): (id: string) => any
}

declare const __dirname: string

declare const process: { cwd(): string }

declare module "node:assert/strict" {
  interface Assert {
    fail(message?: string | Error): never
    equal(actual: unknown, expected: unknown, message?: string): void
    deepEqual(actual: unknown, expected: unknown, message?: string): void
    notStrictEqual(actual: unknown, expected: unknown, message?: string): void
    ok(value: unknown, message?: string): void
    match(actual: string, expected: RegExp, message?: string): void
    doesNotMatch(actual: string, expected: RegExp, message?: string): void
  }
  const assert: Assert
  export default assert
}
declare module "node:vm" {
  const vm: { runInNewContext(code: string, context: Record<string, unknown>, options?: { timeout?: number; filename?: string }): any }
  export default vm
}
