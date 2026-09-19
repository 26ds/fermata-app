import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
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

/**
 * 调色板守门（2026-09-19，M3.15-log 🐞1，创始人选的 A：「用现有最近一档 + 加一道检查」）。
 *
 * 写了调色板里没有的色号，Tailwind 一声不吭：ink 那几档（`ink-200` / `ink-400`…）**根本不生成样式**，字退回继承来的颜色；
 * teal 那几档（`teal-200`…）**悄悄换成 Tailwind 自带的另一种薄荷绿**。tsc、eslint 都拦不住，只有看得出来 ——
 * 这个仓库里攒到过 11 处，最早的一处在线上躺了两个月。
 *
 * 所以生产构建（本地 `npm run build`、Vercel 每一次部署）先把 `src` 扫一遍：撞到就让构建失败、列出文件和行号，
 * 这个版本就发布不出去。**写在 next.config 而不是 package.json 的脚本里**：不管部署平台用哪条命令起构建，
 * 只要是 `next build` 就会经过这里。开发模式（`next dev`）不扫。
 *
 * 调色板以 `src/app/globals.css` 的 `@theme` 为准 —— 真要加一档颜色，先加在那里，这道检查自己就认了。
 * 整行注释不算（`toggle.tsx` 里记着一条前科）；行尾的 `// …` 也剥掉再看。
 */
function offPaletteShades(root: string): string[] {
  const css = readFileSync(join(root, "src/app/globals.css"), "utf8");
  const palette = new Set([...css.matchAll(/--color-((?:ink|teal|leaf)-\d+)\s*:/g)].map((m) => m[1]));
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(tsx?|css)$/.test(entry.name)) continue;
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/^\s*(\/\/|\/\*|\*|\{\/\*)/.test(line)) return;
          const code = line.replace(/\/\*.*?\*\//g, "").replace(/\s\/\/.*$/, "");
          for (const m of code.matchAll(/\b((?:ink|teal|leaf)-\d{2,3})\b/g)) {
            if (!palette.has(m[1])) hits.push(`  ${relative(root, path)}:${i + 1}  ${m[1]}`);
          }
        });
    }
  };
  walk(join(root, "src"));
  return hits;
}

export default function config(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    const hits = offPaletteShades(__dirname);
    if (hits.length > 0) {
      throw new Error(
        [
          "调色板里没有这些色号（Tailwind 不会报错，只会悄悄不生效或跑偏色）—— 换成 globals.css @theme 里有的那几档：",
          "Off-palette colour shades found — use a shade defined in src/app/globals.css @theme:",
          ...hits,
        ].join("\n"),
      );
    }
  }
  return withSerwist(nextConfig);
}
