import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import { cookies } from "next/headers";
import { isLocale } from "@/lib/i18n";
import "./globals.css";

const font = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-arabic", display: "swap",
});

export const metadata: Metadata = { title: "MedCRM", description: "Clinic CRM & ERP platform" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const c = await cookies();
  const l = c.get("locale")?.value;
  const locale = isLocale(l) ? l : "ar";
  const theme = c.get("theme")?.value === "dark" ? "dark" : "";
  return (
    <html lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className={`${font.variable} ${theme}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
