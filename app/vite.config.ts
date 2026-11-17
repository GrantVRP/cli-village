// Builds the desktop app's page into dist/app/renderer, which the village server serves at /app/.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  build: {
    outDir: fileURLToPath(new URL("../dist/app/renderer", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    // No inline scripts or data: URLs for scripts, so the page works with a strict security policy.
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
  },
});
