import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const hostProvidedDependencies = [
  "@tanstack/react-query",
  "@wealthfolio/addon-sdk",
  "@wealthfolio/ui",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "recharts",
];

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": resolve(__dirname, "src") },
  },
  build: {
    lib: {
      entry: resolve(__dirname, "src/addon.tsx"),
      fileName: () => "addon.js",
      formats: ["es"],
    },
    rollupOptions: { external: hostProvidedDependencies },
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
  },
});
