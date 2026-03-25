import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests call runSetup which indexes the project — allow extra time.
    testTimeout: 30000,
    // Run test files sequentially to avoid parallel readline/stdin contention.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
