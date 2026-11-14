import { defineConfig } from "vitest/config";

// Tests that need the Auth and Firestore emulators (security rules and the end-to-end skeleton flow):
//   cd firebase && firebase emulators:exec --only auth,firestore --project demo-twoam "npm --prefix functions run test:emulator"
export default defineConfig({
  test: {
    include: ["test/rules/**/*.test.ts", "test/emulator/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
});
