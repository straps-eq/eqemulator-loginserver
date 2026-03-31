/**
 * Scrypt hashing using libsodium — produces $7$ hashes compatible with
 * the EQEmu loginserver's crypto_pwhash_scryptsalsa208sha256_str_verify.
 */
import sodium from "libsodium-wrappers-sumo";

let _ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!_ready) _ready = sodium.ready;
  return _ready;
}

export async function createScryptHash(password: string): Promise<string> {
  await ensureReady();
  return sodium.crypto_pwhash_scryptsalsa208sha256_str(
    password,
    sodium.crypto_pwhash_scryptsalsa208sha256_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_scryptsalsa208sha256_MEMLIMIT_INTERACTIVE
  ) as unknown as string;
}

export async function verifyScryptHash(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash.startsWith("$7$")) return false;
  await ensureReady();
  try {
    return sodium.crypto_pwhash_scryptsalsa208sha256_str_verify(storedHash, password);
  } catch {
    return false;
  }
}
