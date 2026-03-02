import type { Metadata } from "next";
import "./globals.css";
import Nav from "./Nav";

export const metadata: Metadata = {
  title: "CykelPro Analytics",
  description: "Fantasy cycling analytics for the 2026 classics season",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da">
      <body className="min-h-screen flex" style={{ backgroundColor: "var(--c-bg)", color: "var(--c-text)" }}>
        <Nav />
        <main className="flex-1 min-h-screen overflow-auto">
          {children}
        </main>
      </body>
    </html>
  );
}
