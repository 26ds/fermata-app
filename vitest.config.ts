import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 单元测试（2026-09-26 公开仓库那一片，创始人选 A）。只测纯逻辑：不连数据库、不调模型、不开浏览器。
// `@/` 跟 tsconfig 的 paths 一致；`server-only` 在 Next 之外一 import 就抛，测试里换成空模块。
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
