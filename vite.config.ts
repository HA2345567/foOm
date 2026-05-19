import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

// Load .env variables into process.env so they are available to API handlers running in Vite
try {
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, "utf8");
    envConfig.split("\n").forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        // Trim value to remove carriage returns (\r) on Windows
        let value = (match[2] || "").trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
  }
} catch (err) {
  console.error("Error loading .env in vite.config.ts:", err);
}

// Vite plugin to run serverless functions in the /api directory locally
function apiMiddlewarePlugin(): Plugin {
  return {
    name: "api-middleware",
    configureServer(server) {
      server.middlewares.use(async (req: any, res: any, next) => {
        if (req.url && req.url.startsWith("/api/")) {
          const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
          const endpoint = parsedUrl.pathname.replace(/^\/api\//, "");
          
          // Locate the API file
          const filePath = path.resolve(process.cwd(), "api", `${endpoint}.js`);
          if (fs.existsSync(filePath)) {
            try {
              // Convert absolute Windows path to a valid file:// URL for ES modules
              const fileUrl = pathToFileURL(filePath).href;
              const { default: handler } = await import(`${fileUrl}?update=${Date.now()}`);
              
              // Parse query parameters
              const query: Record<string, string> = {};
              parsedUrl.searchParams.forEach((value, key) => {
                query[key] = value;
              });
              req.query = query;
              
              // Accumulate body data if present
              let bodyBuffer = "";
              req.on("data", (chunk: any) => {
                bodyBuffer += chunk;
              });
              
              req.on("end", async () => {
                try {
                  if (bodyBuffer) {
                    try {
                      req.body = JSON.parse(bodyBuffer);
                    } catch (e) {
                      req.body = bodyBuffer;
                    }
                  } else {
                    req.body = {};
                  }
                  
                  // Mock Vercel response helper methods
                  res.status = (statusCode: number) => {
                    res.statusCode = statusCode;
                    return res;
                  };
                  res.json = (data: any) => {
                    if (!res.writableEnded) {
                      res.setHeader("Content-Type", "application/json");
                      res.end(JSON.stringify(data));
                    }
                    return res;
                  };
                  res.send = (data: any) => {
                    if (!res.writableEnded) {
                      res.end(data);
                    }
                    return res;
                  };
                  
                  // Execute the API handler
                  await handler(req, res);
                } catch (err: any) {
                  console.error(`Error in api handler /api/${endpoint}:`, err);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: "Internal Server Error", details: err.message }));
                }
              });
              return;
            } catch (err: any) {
              console.error(`Failed to load handler /api/${endpoint}:`, err);
              res.statusCode = 500;
              res.end(JSON.stringify({ error: "Failed to load API handler", details: err.message }));
              return;
            }
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tanstackRouter(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
    apiMiddlewarePlugin(),
  ],
  server: {
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
