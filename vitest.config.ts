import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/src/**/*.test.ts', 'server/**/*.test.ts', 'client/**/*.test.ts'],
    environment: 'node',
  },
});
