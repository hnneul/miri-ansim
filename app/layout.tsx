import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "길 안심 제주",
  description: "초보 운전자를 위한 제주 안전경로 추천",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* 세로 배치는 .phone 이 쥔다 (globals.css) — 노트북에서는 그게 폰 프레임이 된다 */}
      <body className="min-h-full">
        <div className="phone">{children}</div>
      </body>
    </html>
  );
}
