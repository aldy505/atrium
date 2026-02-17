import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/server/**/*.ts"],
      exclude: [
        "src/server/index.ts",
        "src/server/sentry.server.ts",
      ],
    },
    testTimeout: 10000,
    hookTimeout: 10000,
  },
});
