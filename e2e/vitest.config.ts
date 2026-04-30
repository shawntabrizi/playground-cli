import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["e2e/**/*.test.ts"],
        testTimeout: 120_000,
        hookTimeout: 60_000,
        globalSetup: ["e2e/cli/setup/global.ts"],
        fileParallelism: false,
        // Chain client WebSockets may keep the event loop alive after teardown.
        // Force exit after tests complete rather than hanging.
        teardownTimeout: 5_000,
    },
});
