import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [preact()],
  worker: { format: "es" },
  server: {
    // `npm run dev -w worker` serves the API on 8787.
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
