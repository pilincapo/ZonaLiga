// Declaración de módulos no estándar para TypeScript.

// El CHANGELOG.md se importa como texto (wrangler lo sube con la regla
// [[rules]] type=Text; Vite lo resuelve con assetsInclude en vitest.config).
declare module '*.md' {
  const content: string;
  export default content;
}

// Import ?raw de archivos de texto (lo soporta Vite en tests: package.json,
// CSS…).
declare module '*?raw' {
  const content: string;
  export default content;
}
