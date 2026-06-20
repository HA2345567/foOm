import { mergeConfig } from "vite";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ["src/**/*.browser.test.ts"],
      browser: {
        enabled: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
      },
      testTimeout: 120_000,
    },
  }),
);
