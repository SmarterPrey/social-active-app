import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { TanStackRouterVite } from "@tanstack/router-vite-plugin";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    // Auto-generate src/routeTree.gen.ts from the file-based routes under src/routes.
    TanStackRouterVite(),
    react(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // The 3D graph, recharts and Amplify drive the bundle size; split them out
    // so the social feed routes stay small for members.
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-graph": ["react-force-graph-3d", "three"],
          "vendor-charts": ["recharts"],
          "vendor-amplify": ["aws-amplify"],
          "vendor-radix": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-tabs",
            "@radix-ui/react-select",
            "@radix-ui/react-slot",
          ],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },
});
