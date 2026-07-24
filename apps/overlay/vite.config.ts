import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Served by the Node server under /overlay, so assets must be prefixed with it.
export default defineConfig({
  base: "/overlay/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
