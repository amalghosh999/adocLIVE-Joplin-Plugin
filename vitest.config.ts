import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/contracts/**/*.test.ts",
    ],
    exclude: ["tests/browser/**", "node_modules/**", "dist/**", "test-lab-dist/**"],
  },
});
