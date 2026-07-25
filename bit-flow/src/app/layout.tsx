import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bit Flow | RAM 퍼즐 실험실",
  description: "비트와 RAM의 동작을 배우는 실시간 교육 퍼즐 게임",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <Script src="https://lounge.letscoding.kr/sdk/letscoding-ranking.js" strategy="beforeInteractive" />
      </body>
    </html>
  );
}
