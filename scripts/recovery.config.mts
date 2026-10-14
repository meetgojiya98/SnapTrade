import { defineConfig } from 'vitest/config';
import baseConfig from '../vitest.config.mts';

// Explicit opt-in: a recovery rehearsal requires compatible PostgreSQL CLI tools
// and a loopback role allowed to create disposable databases.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['scripts/recovery-drill.test.ts'],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
