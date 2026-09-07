import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Keep shared React/runtime dependencies out of lazy feature bundles.
          includeDependenciesRecursively: false,
          groups: [
            { name: "survey-creator-core", test: /node_modules[\\/]survey-creator-core[\\/]/ },
            { name: "survey-creator-react", test: /node_modules[\\/]survey-creator-react[\\/]/ },
            { name: "survey-react-ui", test: /node_modules[\\/]survey-react-ui[\\/]/ },
            { name: "survey-core", test: /node_modules[\\/]survey-core[\\/]/ },
            { name: "exceljs", test: /node_modules[\\/]exceljs[\\/]/ },
            { name: "sentry", test: /node_modules[\\/]@sentry[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    watch: {
      usePolling: true,
    },
  },
});
