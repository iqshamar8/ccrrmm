/**
 * Bilingual strings are written inline as tr("عربي", "English") so both
 * languages always live together and nothing goes untranslated.
 */
export type Locale = "ar" | "en";
export const isLocale = (v: unknown): v is Locale => v === "ar" || v === "en";
export const makeTr = (locale: Locale) => (ar: string, en: string) => (locale === "ar" ? ar : en);

export function fmtDate(d: string | Date | null | undefined, locale: Locale, withTime = false) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-GB", {
    year: "numeric", month: "short", day: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

export function fmtMoney(v: number | string, currency: string, locale: Locale) {
  return new Intl.NumberFormat(locale === "ar" ? "ar-IQ-u-nu-latn" : "en-US", {
    style: "currency", currency, maximumFractionDigits: 2,
  }).format(Number(v));
}
