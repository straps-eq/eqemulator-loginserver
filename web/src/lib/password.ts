import { scryptSync, randomBytes, timingSafeEqual } from "crypto";

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 256 * 16384 * 8 };

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return `${salt}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
    return timingSafeEqual(Buffer.from(hash, "hex"), derived);
  } catch {
    return false;
  }
}
