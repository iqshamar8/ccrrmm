/**
 * Private file storage. Phase 2 uses the local disk (UPLOAD_DIR, default
 * ./uploads, outside /public). Files are stored as <tenantId>/<uuid> with no
 * user-controlled path segments. Swap this module for S3/R2/Azure Blob in
 * production — the rest of the app only uses put/get/remove.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(process.env.UPLOAD_DIR ?? "uploads");

export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/** Checks magic bytes so a renamed .exe can't pass as an image. */
export function sniffMime(buf: Buffer): string | null {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString() === "RIFF" && buf.subarray(8, 12).toString() === "WEBP") return "image/webp";
  if (buf.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  return null;
}

function resolveKey(key: string) {
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new Error("bad storage key");
  return path.join(ROOT, key);
}

export async function putFile(tenantId: string, data: Buffer): Promise<string> {
  const key = `${tenantId}/${randomUUID()}`;
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
  return key;
}

export const getFile = (key: string) => readFile(resolveKey(key));
export const removeFile = (key: string) => rm(resolveKey(key), { force: true });
