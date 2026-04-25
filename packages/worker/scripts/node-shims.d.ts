// Minimal Node.js type shims for script files running under tsx.
// The Workers tsconfig has no @types/node; these stubs satisfy tsc.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: BufferEncoding): string;
  export function readFileSync(path: string, options: { encoding: BufferEncoding }): string;
  export function readFileSync(path: string): Buffer;
}
