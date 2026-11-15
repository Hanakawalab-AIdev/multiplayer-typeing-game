import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the React app runs on Vite (5173) and the game server on 3001.
// Vite forwards Socket.IO traffic (including the WebSocket upgrade) to the server,
// so the client can always connect to its own origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/socket.io": { target: "http://localhost:3001", ws: true },
    },
  },
});
