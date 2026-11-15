/** Exact decimal money math (Prisma.Decimal = decimal.js). Never use floats for money. */
import { Prisma } from "@prisma/client";

export const D = (v: Prisma.Decimal.Value | null | undefined) => new Prisma.Decimal(v ?? 0);
export const ZERO = D(0);
export const r2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
export const sum = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.plus(b), ZERO);
export const min = (a: Prisma.Decimal, b: Prisma.Decimal) => (a.lessThan(b) ? a : b);
export const max0 = (a: Prisma.Decimal) => (a.isNegative() ? ZERO : a);

/** Commission/coupon rule: PERCENT of base, or FIXED × quantity. */
export function applyRate(type: "NONE" | "PERCENT" | "FIXED", value: Prisma.Decimal.Value, base: Prisma.Decimal, qty: Prisma.Decimal.Value = 1) {
  if (type === "PERCENT") return r2(base.times(value).dividedBy(100));
  if (type === "FIXED") return r2(D(value).times(qty));
  return ZERO;
}
