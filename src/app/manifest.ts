import type { MetadataRoute } from "next";
import { getT } from "@/lib/ui-lang";

// PWA 安装卡片上的那句话。改成 `async` 读界面语言 —— 装到主屏那一下，
// 名字和说明用的该是这个人读得懂的语言。
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getT();

  return {
    name: "Fermata",
    short_name: "Fermata",
    description: t("meta.descriptionShort"),
    start_url: "/",
    display: "standalone",
    background_color: "#2c2c2a",
    theme_color: "#2c2c2a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
