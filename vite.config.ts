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
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (
              id.includes("react-router-dom") ||
              id.includes("react-dom") ||
              id.includes("react/") ||
              id.includes("react-is")
            ) {
              return "vendor-react";
            }
            if (id.includes("@supabase")) {
              return "vendor-supabase";
            }
            if (id.includes("recharts")) {
              return "vendor-recharts";
            }
            if (id.includes("maplibre-gl") || id.includes("react-map-gl")) {
              return "vendor-maplibre";
            }
          }
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
