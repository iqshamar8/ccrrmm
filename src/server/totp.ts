/**
 * RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits) — works with Google Authenticator,
 * Microsoft Authenticator, 1Password, Authy… No external dependency.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secret: string, time = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(time / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits).toString().padStart(digits, "0");
  return code;
}

/** Accepts the current code and one step either side (clock drift). */
export function verifyTotp(secret: string, code: string, time = Date.now()) {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) => {
    const expected = Buffer.from(totpAt(secret, time + w * 30000));
    const got = Buffer.from(c);
    return expected.length === got.length && timingSafeEqual(expected, got);
  });
}

export const otpauthUri = (secret: string, account: string, issuer = "MedCRM") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

export const hashRecoveryCode = (c: string) => createHash("sha256").update(c.replace(/[\s-]/g, "").toUpperCase()).digest("hex");

/** 8 one-time recovery codes like "7KQ4-9ZRM". */
export function newRecoveryCodes() {
  return Array.from({ length: 8 }, () => { const s = base32Encode(randomBytes(5)).slice(0, 8); return `${s.slice(0, 4)}-${s.slice(4)}`; });
}
