import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "stat-cast",
  description: "One screen over the stat-cast pitcher marts and the pipeline that feeds them.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='14' fill='%23f4f1ea'/%3E%3Cpath d='M9 5c4 6 4 16 0 22M23 5c-4 6-4 16 0 22' stroke='%23dc3c3d' stroke-width='2' fill='none'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Set the theme before first paint (saved choice, else the OS preference), so
// there is no flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem("statcast-theme");}catch(e){}document.documentElement.dataset.theme=t||(matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
