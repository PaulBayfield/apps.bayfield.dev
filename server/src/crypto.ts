// Sealed cookies: JSON encrypted and authenticated with AES-256-GCM, so the browser can hold the
// session without a database and can neither read nor change it.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { SESSION_SECRET } from "./config.ts";

const KEY = createHash("sha256").update(`apps.bayfield.dev:${SESSION_SECRET}`).digest();

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}

export function unseal<T>(token: string | undefined): T | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
