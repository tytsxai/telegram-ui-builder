import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
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
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "src/**/__tests__/**/*.{ts,tsx}",
      "tests/unit/**/*.{test,spec}.{ts,tsx}"
    ],
    exclude: ["tests/e2e/**"],
  },
}));
