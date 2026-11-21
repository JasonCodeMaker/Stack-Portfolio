import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const hostDependencies = [
  "@wealthfolio/addon-sdk",
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
];

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    target: ["chrome107", "firefox104", "safari16"],
    lib: {
      entry: resolve(__dirname, "src/addon.tsx"),
      fileName: () => "addon.js",
      formats: ["es"],
    },
    rollupOptions: { external: hostDependencies },
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
  },
});
