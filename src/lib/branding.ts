import { z } from "zod";

/** Shared branding rules for clinics (client + server). */
export const HEX = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_PRIMARY = "#0f766e";
export const DEFAULT_ACCENT = "#dcf36b";

/** Uploaded logos are resized in the browser and stored inline (~10-40 KB). */
export const MAX_LOGO_CHARS = 250_000;
const DATA_IMAGE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

export const colourField = z.string().trim().regex(HEX, "Use a hex colour like #0f766e");

/** An https image URL, an inline uploaded image, or empty (no logo). */
export const logoField = z
  .string()
  .trim()
  .max(MAX_LOGO_CHARS, "The logo image is too large")
  .refine((v) => v === "" || DATA_IMAGE.test(v) || /^https:\/\/\S+$/i.test(v), "Upload an image or use an https link")
  .transform((v) => v || null)
  .nullable()
  .optional();

/** Keep audit rows small: never copy the inline image into the log. */
export function brandingForAudit<T extends { logoUrl?: string | null }>(t: T | null): T | null {
  if (!t) return t;
  return t.logoUrl?.startsWith("data:") ? { ...t, logoUrl: "[uploaded image]" } : t;
}

/** Readable text colour (black or white) on top of a given background. */
export function inkOn(hex: string): "#000000" | "#ffffff" {
  if (!HEX.test(hex)) return "#ffffff";
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.4 ? "#000000" : "#ffffff";
}
