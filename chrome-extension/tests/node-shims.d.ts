declare module "node:test" {
  type TestFn = (name: string, fn: () => void | Promise<void>) => void
  const test: TestFn
  export default test
}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string
  export function existsSync(path: string): boolean
}

declare module "node:path" {
  export function join(...parts: string[]): string
}

declare const process: { cwd(): string }

declare module "node:assert/strict" {
  interface Assert {
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
