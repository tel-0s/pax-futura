import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API port follows the server's PAX_PORT so a second instance (or a
// collision on 8787) only needs one env var for both halves.
const apiTarget = `http://localhost:${process.env.PAX_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.PAX_CLIENT_PORT ?? 5173),
    proxy: {
      "/api": { target: apiTarget, changeOrigin: false },
      "/assets": { target: apiTarget, changeOrigin: false },
    },
  },
});
