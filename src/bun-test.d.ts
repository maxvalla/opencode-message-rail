/**
 * Minimal ambient types for Bun's built-in test runner.
 *
 * This package deliberately carries no test-runner dependency (bun's runner is
 * built in) and does not depend on @types/bun, so `import ... from "bun:test"`
 * needs a local declaration for `tsc --noEmit` to resolve it. Only the surface
 * used by src/geom.test.ts is declared.
 *
 * If @types/bun is ever added to devDependencies, delete this file.
 */
declare module "bun:test" {
  export interface Matchers {
    readonly not: Matchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
  }

  export function test(name: string, fn: () => void | Promise<void>): void;

  export function expect(actual: unknown): Matchers;
}
