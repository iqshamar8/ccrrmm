/**
 * Client photos and medical attachments (before/after photos, documents).
 * - type is verified from magic bytes, not the browser-supplied mime
 * - plan storage quota is enforced
 * - medical files require medical.view_data to list, download or upload
 */
import type { FileCategory } from "@prisma/client";
import { audit } from "../audit";
import { type Ctx, requireTenant } from "../context";
import { withTenant } from "../db";
import { badRequest, forbidden, notFound, planLimit } from "../errors";
import { ALLOWED_MIME, getFile, MAX_FILE_BYTES, putFile, removeFile, sniffMime } from "../storage";
import { recordBranchScope } from "./common";

const CATEGORIES: FileCategory[] = ["CLIENT_PHOTO", "MEDICAL_BEFORE", "MEDICAL_AFTER", "MEDICAL_DOCUMENT"];
const isMedical = (c: FileCategory) => c !== "CLIENT_PHOTO";

function guard(ctx: Ctx, category: FileCategory, action: "view" | "create" | "delete") {
  if (isMedical(category)) {
    const tenantId = requireTenant(ctx, `medical.${action}`);
    if (!ctx.permissions.has("medical.view_data")) throw forbidden("Medical files require the 'view medical data' permission");
    return tenantId;
  }
  return requireTenant(ctx, action === "view" ? "clients.view" : "clients.update");
}

export async function listFiles(ctx: Ctx, clientId: string) {
  const tenantId = requireTenant(ctx, "clients.view");
  const medical = ctx.permissions.has("medical.view") && ctx.permissions.has("medical.view_data");
  return withTenant(tenantId, async (tx) => {
    if (!(await tx.client.findFirst({ where: { id: clientId, tenantId, deletedAt: null, ...recordBranchScope(ctx) } }))) throw notFound("Client not found");
    return tx.fileObject.findMany({
      where: { tenantId, clientId, ...(medical ? {} : { category: "CLIENT_PHOTO" }) },
      orderBy: { createdAt: "desc" },
      select: { id: true, category: true, originalName: true, mimeType: true, sizeBytes: true, note: true, createdAt: true },
    });
  });
}

export async function uploadFile(ctx: Ctx, clientId: string, input: { category: string; name: string; data: Buffer; note?: string | null; surgeryId?: string | null; reviewId?: string | null }) {
  const category = input.category as FileCategory;
  if (!CATEGORIES.includes(category)) throw badRequest("Unknown file category");
  const tenantId = guard(ctx, category, "create");
  if (input.data.length === 0) throw badRequest("Empty file");
  if (input.data.length > MAX_FILE_BYTES) throw badRequest("File is larger than 10 MB");
  const mime = sniffMime(input.data);
  if (!mime || !ALLOWED_MIME[mime]) throw badRequest("Only JPG, PNG, WEBP and PDF files are allowed");
  if (category === "CLIENT_PHOTO" && !mime.startsWith("image/")) throw badRequest("Client photo must be an image");

  return withTenant(tenantId, async (tx) => {
    const client = await tx.client.findFirst({ where: { id: clientId, tenantId, deletedAt: null, ...recordBranchScope(ctx) } });
    if (!client) throw notFound("Client not found");
    if ((input.surgeryId || input.reviewId) && !isMedical(category)) throw badRequest("Surgery/review attachments must be medical files");
    if (input.surgeryId && !(await tx.surgery.findFirst({ where: { id: input.surgeryId, tenantId, clientId } }))) throw badRequest("Surgery not found for this client");
    if (input.reviewId && !(await tx.medicalReview.findFirst({ where: { id: input.reviewId, tenantId, clientId } }))) throw badRequest("Review not found for this client");
    const used = await tx.fileObject.aggregate({ where: { tenantId }, _sum: { sizeBytes: true } });
    const quota = (ctx.tenant!.plan?.storageMb ?? 0) * 1024 * 1024;
    if ((used._sum.sizeBytes ?? 0) + input.data.length > quota) throw planLimit("Storage quota of your plan is full");

    const storageKey = await putFile(tenantId, input.data);
    try {
      const f = await tx.fileObject.create({
        data: {
          tenantId, clientId, category, mimeType: mime, sizeBytes: input.data.length, storageKey, uploadedById: ctx.user.id,
          surgeryId: input.surgeryId || null, reviewId: input.reviewId || null,
          originalName: input.name.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120) || "file", note: input.note?.slice(0, 300) || null,
        },
        select: { id: true, category: true, originalName: true, mimeType: true, sizeBytes: true, note: true, createdAt: true },
      });
      if (category === "CLIENT_PHOTO") await tx.client.update({ where: { id: clientId }, data: { photoFileId: f.id } });
      await audit(tx, ctx, { action: "file.upload", entity: "FileObject", entityId: f.id, after: { category, clientId, sizeBytes: f.sizeBytes } });
      return f;
    } catch (e) {
      await removeFile(storageKey); // don't leave orphan bytes if the DB write fails
      throw e;
    }
  });
}

export async function downloadFile(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx, "clients.view");
  const meta = await withTenant(tenantId, async (tx) => {
    const f = await tx.fileObject.findFirst({ where: { id, tenantId }, include: { client: { select: { branchId: true, deletedAt: true } } } });
    if (!f) throw notFound("File not found");
    guard(ctx, f.category, "view");
    const scope = recordBranchScope(ctx);
    if (scope.branchId && f.client && !scope.branchId.in.includes(f.client.branchId)) throw notFound("File not found");
    if (isMedical(f.category)) await audit(tx, ctx, { action: "file.download", entity: "FileObject", entityId: id });
    return f;
  });
  return { meta, data: await getFile(meta.storageKey) };
}

export async function deleteFile(ctx: Ctx, id: string) {
  const tenantId = requireTenant(ctx);
  const key = await withTenant(tenantId, async (tx) => {
    const f = await tx.fileObject.findFirst({ where: { id, tenantId } });
    if (!f) throw notFound("File not found");
    guard(ctx, f.category, "delete");
    await tx.fileObject.delete({ where: { id } });
    if (f.category === "CLIENT_PHOTO" && f.clientId) {
      await tx.client.updateMany({ where: { id: f.clientId, photoFileId: id }, data: { photoFileId: null } });
    }
    await audit(tx, ctx, { action: "file.delete", entity: "FileObject", entityId: id, before: { category: f.category, clientId: f.clientId } });
    return f.storageKey;
  });
  await removeFile(key);
  return { ok: true };
}
