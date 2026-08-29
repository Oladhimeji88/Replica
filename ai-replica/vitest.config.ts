import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Every test imports what it uses; no ambient globals to guess at.
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      // Entrypoint and vendor adapters are covered by running the thing, not
      // by unit tests that would only assert the mocks were called.
      exclude: ["src/server.ts", "src/providers/**/*.ts", "src/core/logger.ts"],
    },
  },
});
