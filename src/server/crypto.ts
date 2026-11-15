/**
 * Encryption for third-party secrets stored in the database (WhatsApp access
 * token, app secret). AES-256-GCM with a random IV per value.
 * Key: DATA_ENCRYPTION_KEY (32 bytes, base64 or hex) — falls back to a key
 * derived from SESSION_SECRET so development works out of the box.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function key(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (raw) {
    const b = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (b.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes (base64 or hex)");
    return b;
  }
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("DATA_ENCRYPTION_KEY or SESSION_SECRET is required");
  return createHash("sha256").update(`medcrm:data:${s}`).digest();
}

/** "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  const [v, iv, tag, data] = value.split(".");
  if (v !== "v1" || !iv || !tag || !data) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Constant-time check of Meta's X-Hub-Signature-256 header ("sha256=<hex>"). */
export function verifyHubSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  const got = Buffer.from(header.slice(7), "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");
