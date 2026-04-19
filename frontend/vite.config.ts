import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, "/");

          if (normalizedId.includes("/node_modules/survey-creator-core/")) {
            return "survey-creator-core";
          }

          if (normalizedId.includes("/node_modules/survey-creator-react/")) {
            return "survey-creator-react";
          }

          if (normalizedId.includes("/node_modules/survey-react-ui/")) {
            return "survey-react-ui";
          }

          if (normalizedId.includes("/node_modules/survey-core/")) {
            return "survey-core";
          }

          if (normalizedId.includes("/node_modules/exceljs/")) {
            return "exceljs";
          }

          if (normalizedId.includes("/node_modules/@sentry/")) {
            return "sentry";
          }
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
