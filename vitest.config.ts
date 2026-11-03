import { defineConfig } from 'vitest/config';

// Ein Testlauf für alle Pakete. Server-Tests mit echter Workers-Laufzeit
// (Durable Objects) kommen ab M2 als eigenes Projekt dazu.
export default defineConfig({
  test: {
    include: ['shared/test/**/*.test.ts', 'client/test/**/*.test.ts', 'server/test/**/*.test.ts'],
    environment: 'node',
  },
});
