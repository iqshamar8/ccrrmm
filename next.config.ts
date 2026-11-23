import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Content-Security-Policy. Next.js injects inline bootstrap scripts, so
 * script-src needs 'unsafe-inline' (nonces would force every page dynamic).
 * The real protection here: no third-party scripts, no plugins, no <base>
 * hijack, no framing, forms and fetches only to this origin.
 * img-src allows https: because clinics set their logo by URL.
 * Fonts come from next/font, which self-hosts them at build time.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // No upgrade-insecure-requests: it breaks `next start` on http://localhost,
  // and Vercel already forces HTTPS (HSTS).
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  // Optional separate build folder, so two local servers can run side by side (e.g. NEXT_DIST_DIR=.next-landing).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API responses carry tenant/medical data: never cache them anywhere.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default config;
