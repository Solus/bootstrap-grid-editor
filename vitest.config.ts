import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests are co-located as *.test.ts alongside the code they cover.
    include: ['packages/*/src/**/*.test.ts'],
    environment: 'node',
  },
});
