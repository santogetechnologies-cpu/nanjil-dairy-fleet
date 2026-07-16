import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tailwindcss(), tsconfigPaths()],
  // Use './' base so Capacitor can load assets from file:// filesystem
  base: "./",
  build: {
    // Increase warning limit — Capacitor bundles are inherently larger
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Split vendor chunks for faster mobile startup
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-supabase": ["@supabase/supabase-js"],
          "vendor-recharts": ["recharts"],
          "vendor-maplibre": ["maplibre-gl", "react-map-gl"],
        },
      },
    },
  },
  server: {
    host: "::",
    port: 8080,
    strictPort: true,
    allowedHosts: true,
  },
});
