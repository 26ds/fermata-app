import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import { CopyProvider } from "@/components/copy-provider";
import { getUiLang } from "@/lib/ui-lang";
import "./globals.css";

// 字体三件套（next/font 会在构建时把字体文件自包含进来，运行时零外部请求）：
//   Inter        — 全局 UI 无衬线，比系统栈更稳、字重更实
//   Instrument   — 标题衬线，撑住"影院感"
//   JetBrains    — 模型名/计时/徽章等技术字段，等宽不跳动
// 中文由系统字体接管（见 globals.css 的 --font-sans 回退链）。
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fermata",
  description: "视频时代的主动学习层 — 停留之处即学习之处",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Fermata",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#2c2c2a",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

// M3.9 片 b：根布局变 `async`，因为界面语言要在**第一个字节之前**就定下来。
//
// `<html lang>` 原来写死 `zh-CN`，那是 D42 明令禁止的那种硬编码 —— 读屏软件会
// 用中文去念一整屏英文。语言从 cookie 镜像来（`getUiLang`），读不到就看
// `Accept-Language`，再读不到才英文。
//
// ⚠️ **代价说清楚**：读 cookie 会让所有页面进动态渲染。实测确认过这不是新增开销 ——
// 八个页面本来就页页 `auth.getUser()`、`proxy.ts` 还在跑鉴权刷新，本来就全是动态的。
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const uiLang = await getUiLang();

  return (
    <html
      lang={uiLang}
      className={`h-full antialiased ${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-full flex flex-col">
        <CopyProvider lang={uiLang}>{children}</CopyProvider>
      </body>
    </html>
  );
}
