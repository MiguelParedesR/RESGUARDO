import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@ops/ui": path.resolve(__dirname, "../../packages/ui/src/index.tsx"),
      "@ops/maps": path.resolve(__dirname, "../../packages/maps/src/index.tsx"),
      "@ops/alerts": path.resolve(__dirname, "../../packages/alerts/src/index.ts"),
      "@ops/tracking": path.resolve(
        __dirname,
        "../../packages/tracking/src/index.ts"
      ),
      "@ops/auth": path.resolve(__dirname, "../../packages/auth/src/index.ts"),
      "@ops/supabase": path.resolve(
        __dirname,
        "../../services/supabase/src/index.ts"
      ),
      "@ops/module-admin-dashboard": path.resolve(
        __dirname,
        "../../modules/admin-dashboard/src/index.tsx"
      ),
      "@ops/module-custodia-mobile": path.resolve(
        __dirname,
        "../../modules/custodia-mobile/src/index.tsx"
      ),
      "@ops/module-tracking": path.resolve(
        __dirname,
        "../../modules/tracking/src/index.tsx"
      ),
      "@ops/module-alarm-system": path.resolve(
        __dirname,
        "../../modules/alarm-system/src/index.tsx"
      )
    }
  },
  server: {
    port: 5173,
    host: true
  }
});
