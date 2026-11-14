import { defineConfig } from "vitest/config";

// Unit tests. Tests that need the emulators (test/rules, test/emulator) run with `npm run test:emulator`.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/rules/**", "test/emulator/**", "node_modules/**"],
  },
});
