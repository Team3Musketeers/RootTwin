import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const api = "http://localhost:8000";
// dev server proxies the API so the app works the same in dev (5173) and when served by the API (8000)
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/state": api, "/events": api, "/command": api, "/copilot": api, "/play": api, "/machines": api,
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
});
