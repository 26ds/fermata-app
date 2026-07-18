// 生成 PWA 图标：延长记号（fermata 𝄐）— 弧线 + 圆点，电光青 on 影院暗底
// 用法：node scripts/gen-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const art = (size, { rounded }) => {
  const s = size / 512;
  const rx = rounded ? 115 * s : 0;
  return Buffer.from(`<svg width="${size}" height="${size}" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="${rx}" fill="#2c2c2a"/>
  <path d="M 118 312 A 138 138 0 0 1 394 312" stroke="#5dcaa5" stroke-width="36" fill="none" stroke-linecap="round"/>
  <circle cx="256" cy="308" r="34" fill="#5dcaa5"/>
</svg>`);
};

mkdirSync("public/icons", { recursive: true });

await sharp(art(512, { rounded: true })).png().toFile("public/icons/icon-512.png");
await sharp(art(512, { rounded: true })).resize(192, 192).png().toFile("public/icons/icon-192.png");
// maskable / apple-touch-icon：满幅方形底，系统自己裁圆角
await sharp(art(512, { rounded: false })).png().toFile("public/icons/icon-maskable-512.png");
await sharp(art(512, { rounded: false })).resize(180, 180).png().toFile("public/apple-touch-icon.png");
// favicon（Next 用 src/app/icon.png 自动生成）
await sharp(art(512, { rounded: true })).resize(64, 64).png().toFile("src/app/icon.png");

console.log("icons generated: public/icons/*, public/apple-touch-icon.png, src/app/icon.png");
