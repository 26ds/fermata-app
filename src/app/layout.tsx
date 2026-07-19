import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`h-full antialiased ${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
