import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "node",
    exclude: ["node_modules/**", "e2e/**", ".output/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      exclude: [
        "node_modules/**",
        "src/routeTree.gen.ts",
        "src/integrations/**",
        "src/components/ui/**",
        "**/__tests__/**",
        "**/*.test.ts",
        "**/*.test.tsx",
        ".output/**",
      ],
      // Minimum thresholds — CI will fail if coverage drops below these
      thresholds: {
        branches: 40,
        functions: 50,
        lines: 50,
        statements: 50,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
