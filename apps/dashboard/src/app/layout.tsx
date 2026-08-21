import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/layout/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gestor - Multi-Marketplace Inventory",
  description: "Sistema centralizado de gestión para Mercado Libre y otros marketplaces",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" data-theme="dark">
      <head>
        {/* Toggle de tema sin flash (placeholder for future implementation) */}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--bg)] text-[var(--text)]`}>
        <div className="flex h-screen overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-y-auto bg-[var(--bg)] p-8">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
