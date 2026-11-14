import { defineConfig } from "vitest/config";

// Unit tests. Security rules tests need the Firestore emulator and run with `npm run test:rules`.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/rules/**", "node_modules/**"],
  },
});
