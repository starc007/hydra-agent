// Minimal Node.js type shims for script files running under tsx.
// The Workers tsconfig has no @types/node; these stubs satisfy tsc.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: BufferEncoding): string;
  export function readFileSync(path: string, options: { encoding: BufferEncoding }): string;
  export function readFileSync(path: string): Buffer;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
}
