import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
const isSyncTelemetryRun = process.argv.some((arg) => arg.includes("syncTelemetry.test.ts"));
const isSupabaseSyncRun = process.argv.some((arg) => arg.includes("useSupabaseSync.test.ts"));
const isErrorReportingRun = process.argv.some((arg) => arg.includes("errorReporting.test.ts"));
const isAutoSaveRun = process.argv.some((arg) => arg.includes("useAutoSave.test.ts"));
const isSupabaseRetryRun = process.argv.some((arg) => arg.includes("supabaseRetry.test.ts"));
const isDataAccessRun = process.argv.some((arg) => arg.includes("dataAccess.test.ts"));
const coverageTmpDir = path.resolve(__dirname, "test-results", "coverage-tmp");

try {
  fs.mkdirSync(coverageTmpDir, { recursive: true });
} catch {
  // Best-effort for local runs.
}
const isPendingQueueRun = process.argv.some((arg) => arg.includes("pendingQueue.test.ts"));
const isCallbackHelperRun = process.argv.some((arg) => arg.includes("callbackHelper.test.ts"));

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          router: ["react-router-dom"],
          diagram: ["reactflow"],
          icons: ["lucide-react"],
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  plugins: [react()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["tests/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "src/**/__tests__/**/*.{ts,tsx}",
      "tests/unit/**/*.{test,spec}.{ts,tsx}"
    ],
    exclude: ["tests/e2e/**"],
    coverage: {
      enabled: true,
      provider: "v8",
      reporter: ["text", "lcov"],
      include: isPendingQueueRun
        ? ["src/lib/pendingQueue.ts"]
        : isSyncTelemetryRun
          ? ["src/lib/syncTelemetry.ts"]
          : isSupabaseSyncRun
            ? ["src/hooks/chat/useSupabaseSync.ts"]
          : isSupabaseRetryRun
            ? ["src/lib/supabaseRetry.ts"]
            : isErrorReportingRun
              ? ["src/lib/errorReporting.ts"]
              : isCallbackHelperRun
                ? ["src/lib/callbackHelper.ts"]
                : isAutoSaveRun
                  ? ["src/hooks/useAutoSave.ts"]
                  : isDataAccessRun
                    ? ["src/lib/dataAccess.ts"]
                    : ["src/lib/validation.ts"],
      reportsDirectory: "coverage",
      tempDirectory: "test-results/coverage-tmp",
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
      },
      perFile: true,
    },
  },
}));
