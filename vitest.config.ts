import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Le test de bout en bout interroge une pile reelle : il attend jusqu'a 10 s
    // la propagation d'un evenement, d'ou une marge superieure au defaut de 5 s.
    testTimeout: 25_000,
    hookTimeout: 25_000,
    reporters: ['default'],
  },
});
