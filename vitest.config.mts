import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite resolves the `@/*` alias from tsconfig natively (no plugin needed).
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["src/lib/**/*.ts"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90,
        branches: 80,
      },
    },
  },
});
