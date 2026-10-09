import { defineConfig } from "vite";
export default defineConfig({
  cacheDir: "/tmp/twyne-model-eval-vite-cache",
  server: { host: "127.0.0.1", port: 5198, strictPort: true, hmr: false },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
});
