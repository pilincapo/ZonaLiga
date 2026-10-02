// Tipos de los módulos de Node que usan SOLO los tests de auditoría de D1.
//
// El proyecto no tiene @types/node (no lo necesita: la app corre en Workers y
// solo usa tipos de @cloudflare/workers-types). Estos dos tests levantan una
// base sqlite en memoria para MEDIR el coste de cada pantalla, así que necesitan
// declaración de node:sqlite / node:fs / node:path / node:url.
//
// Es una declaración mínima a propósito: si algún día hace falta más de Node en
// los tests, lo correcto es instalar @types/node, no crecer este archivo.

declare module 'node:sqlite' {
  export class StatementSync {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function resolve(...parts: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

/** `import.meta.url` existe en Node y en Vite; los tipos de Workers no lo declaran. */
interface ImportMeta {
  url: string;
}
