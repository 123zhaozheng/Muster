import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./", // relative so Electron can load dist/index.html via file://
  server: { port: 5173, strictPort: true },
  test: { environment: "jsdom", globals: true },
} as import("vite").UserConfig);
