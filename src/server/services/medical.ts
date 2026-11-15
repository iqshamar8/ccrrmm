/**
 * Electronic medical record. Every read/write requires medical.view_data on
 * top of the medical.* action permission. Medical CONTENT is never copied into
 * the audit log (admins without medical access can read the log); we record
 * only which fields changed. Every view is itself audited (access log).
 */
import { z } from "zod";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { type Tx, withTenant } from "../db";
import { forbidden, notFound } from "../errors";
import { optText, recordBranchScope } from "./common";

function requireMedical(ctx: Ctx, action: "view" | "create" | "update" | "delete") {
  const tenantId = requireTenant(ctx, `medical.${action}`);
  if (!ctx.permissions.has("medical.view_data")) throw forbidden("Medical data requires the 'view medical data' permission");
  return tenantId;
}

async function assertClient(tx: Tx, ctx: Ctx, tenantId: string, clientId: string) {
  const c = await tx.client.findFirst({ where: { id: clientId, tenantId, deletedAt: null, ...recordBranchScope(ctx) }, select: { id: true } });
  if (!c) throw notFound("Client not found");
}

export const medicalRecordSchema = z.object({
  bloodType: z.string().trim().max(5).optional().nullable().transform((v) => v || null),
  allergies: optText(), currentMedications: optText(), chronicConditions: optText(), pastSurgeries: optText(),
  medicalHistory: optText(), familyHistory: optText(), notes: optText(),
});

export const medicalEntrySchema = z.object({
  type: z.enum(["DIAGNOSIS", "NOTE", "TREATMENT_PLAN", "FOLLOW_UP_RESULT"]),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(10000),
  appointmentId: z.string().uuid().optional().nullable(),
});

export async function getMedical(ctx: Ctx, clientId: string) {
  const tenantId = requireMedical(ctx, "view");
  return withTenant(tenantId, async (tx) => {
    await assertClient(tx, ctx, tenantId, clientId);
    const [record, entries] = await Promise.all([
      tx.medicalRecord.findUnique({ where: { clientId } }),
      tx.medicalEntry.findMany({ where: { tenantId, clientId }, orderBy: { createdAt: "desc" }, include: { author: { select: { fullName: true } } } }),
    ]);
    await audit(tx, ctx, { action: "medical.view", entity: "Client", entityId: clientId });
    return { record, entries };
  });
}

export async function saveMedicalRecord(ctx: Ctx, clientId: string, raw: unknown) {
  const tenantId = requireMedical(ctx, "update");
  const data = medicalRecordSchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await assertClient(tx, ctx, tenantId, clientId);
    const before = await tx.medicalRecord.findUnique({ where: { clientId } });
    const record = await tx.medicalRecord.upsert({
      where: { clientId },
      create: { ...data, clientId, tenantId, updatedById: ctx.user.id },
      update: { ...data, updatedById: ctx.user.id },
    });
    const changed = Object.keys(data).filter((k) => (before as Record<string, unknown> | null)?.[k] !== (data as Record<string, unknown>)[k]);
    await audit(tx, ctx, { action: "medical.record.save", entity: "MedicalRecord", entityId: clientId, after: { changedFields: changed } });
    return record;
  });
}

export async function addMedicalEntry(ctx: Ctx, clientId: string, raw: unknown) {
  const tenantId = requireMedical(ctx, "create");
  const data = medicalEntrySchema.parse(raw);
  return withTenant(tenantId, async (tx) => {
    await assertClient(tx, ctx, tenantId, clientId);
    if (data.appointmentId && !(await tx.appointment.findFirst({ where: { id: data.appointmentId, tenantId, clientId } }))) {
      throw notFound("Appointment not found");
    }
    const e = await tx.medicalEntry.create({
      data: { ...data, tenantId, clientId, authorId: ctx.user.id }, include: { author: { select: { fullName: true } } },
    });
    await audit(tx, ctx, { action: "medical.entry.create", entity: "MedicalEntry", entityId: e.id, after: { type: e.type, clientId } });
    return e;
  });
}

export async function updateMedicalEntry(ctx: Ctx, id: string, raw: unknown) {
  const tenantId = requireMedical(ctx, "update");
  const data = medicalEntrySchema.partial().parse(raw);
  return withTenant(tenantId, async (tx) => {
    const before = await tx.medicalEntry.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Entry not found");
    await assertClient(tx, ctx, tenantId, before.clientId);
    const e = await tx.medicalEntry.update({ where: { id }, data, include: { author: { select: { fullName: true } } } });
    await audit(tx, ctx, { action: "medical.entry.update", entity: "MedicalEntry", entityId: id, after: { changedFields: Object.keys(data) } });
    return e;
  });
}

export async function deleteMedicalEntry(ctx: Ctx, id: string) {
  const tenantId = requireMedical(ctx, "delete");
  return withTenant(tenantId, async (tx) => {
    const before = await tx.medicalEntry.findFirst({ where: { id, tenantId } });
    if (!before) throw notFound("Entry not found");
    await assertClient(tx, ctx, tenantId, before.clientId);
    await tx.medicalEntry.delete({ where: { id } });
    await audit(tx, ctx, { action: "medical.entry.delete", entity: "MedicalEntry", entityId: id, before: { type: before.type, clientId: before.clientId } });
    return { ok: true };
  });
}
