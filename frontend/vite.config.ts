import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const api = "http://localhost:8000";
// the dev server proxies the API so the app behaves the same in dev (5173) and when served by the API (8000)
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/state": api, "/events": api, "/command": api, "/copilot": api, "/play": api, "/machines": api,
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 1500 },
});
