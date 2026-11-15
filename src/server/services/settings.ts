/** Billing, loyalty and commission-rule settings (one row per tenant). */
import { z } from "zod";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";

export async function settingsTx(tx: Tx, tenantId: string) {
  return (await tx.tenantSettings.findUnique({ where: { tenantId } })) ?? tx.tenantSettings.create({ data: { tenantId } });
}

export const settingsSchema = z.object({
  taxName: z.string().trim().min(1).max(60),
  defaultTaxRate: z.coerce.number().min(0).max(100),
  invoiceDueDays: z.coerce.number().int().min(0).max(365),
  invoiceFooter: z.string().trim().max(1000).optional().nullable().transform((v) => v || null),
  loyaltyEnabled: z.boolean(),
  pointsPerUnit: z.coerce.number().min(0).max(1000),
  pointValue: z.coerce.number().min(0).max(1e9),
  minRedeemPoints: z.coerce.number().int().min(0).max(1e9),
  reviewCommissionAmount: z.coerce.number().min(0).max(1e9),
  productCommissionPercent: z.coerce.number().min(0).max(100),
  autoConsumeMaterials: z.boolean(),
  blockOnStockShortage: z.boolean(),
}).partial();

export async function getSettings(ctx: Ctx) {
  const tenantId = requireTenant(ctx, ctx.permissions.has("settings.view") ? "settings.view" : "invoices.view");
  return withTenant(tenantId, (tx) => settingsTx(tx, tenantId));
}

export async function updateSettings(ctx: Ctx, raw: unknown) {
  const tenantId = requireTenant(ctx, "settings.update");
  const d = settingsSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await settingsTx(tx, tenantId);
    const after = await tx.tenantSettings.update({ where: { tenantId }, data: d });
    await audit(tx, ctx, { action: "settings.billing.update", entity: "TenantSettings", entityId: tenantId, before, after });
    return after;
  });
}
