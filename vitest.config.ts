import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/checks/*.ts", "src/components/*.tsx", "src/latex/*.ts", "src/utils/*.ts"],
      exclude: ["src/latex/registerLatexCompletions.ts"],
    },
  },
});
