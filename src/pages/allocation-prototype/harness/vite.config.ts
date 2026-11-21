// PROTOTYPE harness dev server: `npm run prototype`.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "../../..") } },
  server: { port: 5190, strictPort: true },
});
