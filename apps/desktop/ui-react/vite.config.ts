import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

const workspaceRoot = path.resolve(__dirname, "../../..");

function desktopBundleSizeGuardPlugin(): Plugin {
  return {
    name: "desktop-bundle-size-guard",
    closeBundle() {
      const distDir = path.resolve(process.cwd(), "dist");
      const excludedPaths = [path.join(distDir, "downloads")];

      for (const excludedPath of excludedPaths) {
        fs.rmSync(excludedPath, { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  resolve: {
    alias: {
      react: path.resolve(workspaceRoot, "node_modules/react"),
      "react-dom": path.resolve(workspaceRoot, "node_modules/react-dom"),
      "react/jsx-runtime": path.resolve(workspaceRoot, "node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(workspaceRoot, "node_modules/react/jsx-dev-runtime.js"),
      "@/components/video-editor": path.resolve(__dirname, "src/components/vedio-editor"),
      "@": path.resolve(__dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  plugins: [
    tanstackRouter(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
    desktopBundleSizeGuardPlugin(),
  ],
  server: {
    port: 5174,
    strictPort: true,
    headers: {
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    },
  },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
