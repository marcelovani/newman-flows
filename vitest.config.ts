import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    projects: [
      {
        // Unit tests — pure functions, no network, no filesystem I/O
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.{test,spec}.ts'],

        },
      },
      {
        // Integration tests — start mock server, run full request pipelines
        test: {
          name: 'integration',
          environment: 'node',
          pool: 'forks',
          poolOptions: { forks: { singleFork: true } },
          setupFiles: ['test/integration/setup.ts'],
          include: ['test/integration/**/*.{test,spec}.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['node_modules/', 'test/', 'dist/', '**/*.d.ts', '**/*.config.ts'],
      reportsDirectory: './test/coverage',
    },
  },
});
