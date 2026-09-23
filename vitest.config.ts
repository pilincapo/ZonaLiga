import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Permite leer el CSS con import ?raw (verificación de los temas).
    css: true,
  },
});
