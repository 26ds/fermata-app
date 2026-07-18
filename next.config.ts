import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // 桌面上层目录里散落着其他 node 项目的 lockfile，显式锚定项目根
  outputFileTracingRoot: __dirname,
  // dev 走 Turbopack（Serwist 此时 disable）；生产构建走 `next build --webpack` 让 Serwist 生成 sw.js。
  // 空对象用于告诉 Next：webpack 配置来自插件，Turbopack 下忽略即可。
  turbopack: {},
};

export default withSerwist(nextConfig);
