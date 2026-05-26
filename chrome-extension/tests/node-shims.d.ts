declare module "node:test" {
  type TestFn = (name: string, fn: () => void | Promise<void>) => void
  const test: TestFn
  export default test
}

declare module "node:assert/strict" {
  interface Assert {
    equal(actual: unknown, expected: unknown, message?: string): void
    deepEqual(actual: unknown, expected: unknown, message?: string): void
  }
  const assert: Assert
  export default assert
}
