import type { Metadata, Viewport } from "next";

import { AppProvider } from "@/components/AppProvider";
import { TabBar } from "@/components/TabBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mercadito",
  description: "Lista de mercado compartilhada com histórico de compras.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Mercadito",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfa" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh">
        <AppProvider>
          {/* padding reserva o espaco da barra: embaixo no mobile, em cima no desktop */}
          <main className="mx-auto max-w-xl px-4 pb-28 pt-4 md:pb-10 md:pt-20">
            {children}
          </main>
          <TabBar />
        </AppProvider>
      </body>
    </html>
  );
}
