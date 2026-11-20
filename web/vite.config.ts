import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// `npm run dev -w worker` serves the API on 8787; KAYUH_API points the dev proxy elsewhere.
const API = process.env.KAYUH_API ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [preact()],
  worker: { format: "es" },
  server: {
    proxy: {
      "/api": {
        target: API,
        changeOrigin: true,
        // The API's CSRF guard wants a same-origin request: present the proxied call as coming from the API's own origin.
        configure: (proxy) => proxy.on("proxyReq", (req) => { if (req.getHeader("origin")) req.setHeader("origin", API); }),
      },
    },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
