"use client";
import { useSession } from "@/components/providers";
import { fmtMoney } from "@/lib/i18n";

/** Formats amounts in the tenant's base currency and locale. */
export function useMoney() {
  const { locale, tenant } = useSession();
  const cur = tenant?.baseCurrency ?? "USD";
  return (v: number | string | null | undefined) => (v === null || v === undefined ? "—" : fmtMoney(Number(v), cur, locale));
}
