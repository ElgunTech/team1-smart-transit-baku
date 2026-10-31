import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` proxies the API to the FastAPI server on :8000.
// `npm run build` writes the bundle to ../static, which FastAPI serves in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
});
