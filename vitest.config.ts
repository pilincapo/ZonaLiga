import { defineConfig, type Plugin } from 'vitest/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Carga los .md importados como texto (igual que hace wrangler con su regla
// [[rules]] type=Text para el mismo archivo en producción).
function markdownLoader(): Plugin {
  return {
    name: 'markdown-loader',
    enforce: 'pre',
    load(id) {
      if (id.endsWith('.md')) {
        return `export default ${JSON.stringify(readFileSync(resolve(id), 'utf8'))};`;
      }
    },
  };
}

export default defineConfig({
  plugins: [markdownLoader()],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Permite leer el CSS con import ?raw (verificación de los temas).
    css: true,
    // Los e2e contra wrangler dev arrancan servidor y base por test suite:
    // 5s default alcanza justo y genera fallos espurios (flaky conocido).
    testTimeout: 30_000,
  },
});
