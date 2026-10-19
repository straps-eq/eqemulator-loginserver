/**
 * Federation cryptography — Ed25519 keypair generation, request signing, and verification.
 * Uses libsodium-wrappers-sumo (already installed for scrypt).
 */
import sodium from "libsodium-wrappers-sumo";

let _ready: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!_ready) _ready = sodium.ready;
  return _ready;
}

export interface KeyPair {
  publicKey: string; // hex-encoded
  privateKey: string; // hex-encoded
}

/** Generate a new Ed25519 keypair, returned as hex strings. */
export async function generateKeyPair(): Promise<KeyPair> {
  await ensureReady();
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: sodium.to_hex(kp.publicKey),
    privateKey: sodium.to_hex(kp.privateKey),
  };
}

/**
 * Build the signed message.
 * Legacy (<= 1.6.x): `${timestamp}\n${method}\n${path}\n${bodyHash}`
 * Recipient-bound (1.7.0+, security M1): legacy + `\n${recipientPublicKey}`,
 * sent together with the `X-Federation-Recipient` header, so a request signed
 * for one node cannot be replayed against another.
 */
function buildMessage(
  timestamp: string,
  method: string,
  path: string,
  body: string,
  recipient?: string | null
): string {
  const bodyHash = sodium.to_hex(
    sodium.crypto_generichash(32, sodium.from_string(body || ""), null)
  );
  const base = `${timestamp}\n${method}\n${path}\n${bodyHash}`;
  return recipient ? `${base}\n${recipient.toLowerCase()}` : base;
}

/**
 * Sign a federation request. Returns a hex-encoded signature.
 * Pass `recipient` (the recipient's public key, hex) to bind the signature to it.
 */
export async function signRequest(
  privateKeyHex: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
  recipient?: string | null
): Promise<string> {
  await ensureReady();
  const message = buildMessage(timestamp, method, path, body, recipient);
  const privateKey = sodium.from_hex(privateKeyHex);
  const signature = sodium.crypto_sign_detached(
    sodium.from_string(message),
    privateKey
  );
  return sodium.to_hex(signature);
}

/**
 * Verify a federation request signature.
 * Returns true if valid, false otherwise.
 */
export async function verifySignature(
  publicKeyHex: string,
  signatureHex: string,
  timestamp: string,
  method: string,
  path: string,
  body: string,
  recipient?: string | null
): Promise<boolean> {
  await ensureReady();
  try {
    const message = buildMessage(timestamp, method, path, body, recipient);
    const publicKey = sodium.from_hex(publicKeyHex);
    const signature = sodium.from_hex(signatureHex);
    return sodium.crypto_sign_verify_detached(
      signature,
      sodium.from_string(message),
      publicKey
    );
  } catch {
    return false;
  }
}

/** Sign an arbitrary message (hex-encoded signature). Used for signed responses. */
export async function signMessage(privateKeyHex: string, message: string): Promise<string> {
  await ensureReady();
  return sodium.to_hex(
    sodium.crypto_sign_detached(sodium.from_string(message), sodium.from_hex(privateKeyHex))
  );
}

/** Verify a signature made by signMessage. */
export async function verifyMessage(publicKeyHex: string, signatureHex: string, message: string): Promise<boolean> {
  await ensureReady();
  try {
    return sodium.crypto_sign_verify_detached(
      sodium.from_hex(signatureHex),
      sodium.from_string(message),
      sodium.from_hex(publicKeyHex)
    );
  } catch {
    return false;
  }
}

/** Generate a random bootstrap token (hex-encoded, 32 bytes). */
export async function generateBootstrapToken(): Promise<string> {
  await ensureReady();
  return sodium.to_hex(sodium.randombytes_buf(32));
}

/** Hash a token with BLAKE2b for safe DB storage. */
export async function hashToken(token: string): Promise<string> {
  await ensureReady();
  return sodium.to_hex(
    sodium.crypto_generichash(32, sodium.from_string(token), null)
  );
}

/**
 * Generate a human-readable fingerprint from a public key hex string.
 * Format: "AB:CD:EF:12:34:56:78:9A" (first 8 bytes of BLAKE2b hash).
 * Used for out-of-band verification during federation join.
 */
export async function publicKeyFingerprint(publicKeyHex: string): Promise<string> {
  await ensureReady();
  const hash = sodium.crypto_generichash(
    16,
    sodium.from_hex(publicKeyHex),
    null
  );
  return sodium
    .to_hex(hash)
    .toUpperCase()
    .match(/.{2}/g)!
    .join(":");
}

// ── Private key encryption at rest ──

/**
 * Derive a 32-byte encryption key from FEDERATION_KEY_ENCRYPTION_SECRET.
 * Falls back to SESSION_SECRET if the dedicated var is not set.
 * Throws if neither is available.
 */
function getEncryptionKey(): Uint8Array {
  const secret =
    process.env.FEDERATION_KEY_ENCRYPTION_SECRET || process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "FEDERATION_KEY_ENCRYPTION_SECRET or SESSION_SECRET must be set for private key encryption"
    );
  }
  return sodium.crypto_generichash(
    sodium.crypto_secretbox_KEYBYTES,
    sodium.from_string(secret),
    null
  );
}

/**
 * Encrypt a hex-encoded private key for DB storage.
 * Returns a string in the format "enc:v1:<nonce_hex>:<ciphertext_hex>".
 */
export async function encryptPrivateKey(privateKeyHex: string): Promise<string> {
  await ensureReady();
  const key = getEncryptionKey();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const plaintext = sodium.from_string(privateKeyHex);
  const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, key);
  return `enc:v1:${sodium.to_hex(nonce)}:${sodium.to_hex(ciphertext)}`;
}

/**
 * Decrypt a private key from DB storage.
 * Accepts both encrypted ("enc:v1:...") and legacy plaintext hex strings.
 */
export async function decryptPrivateKey(stored: string): Promise<string> {
  await ensureReady();
  if (!stored.startsWith("enc:v1:")) {
    // Legacy plaintext — return as-is
    return stored;
  }
  const parts = stored.split(":");
  if (parts.length !== 4) throw new Error("Malformed encrypted private key");
  const nonce = sodium.from_hex(parts[2]);
  const ciphertext = sodium.from_hex(parts[3]);
  const key = getEncryptionKey();
  const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(plaintext);
}

// ── Generic string encryption (for WS admin passwords, etc.) ──

/**
 * Encrypt an arbitrary string for DB storage.
 * Returns "enc:v1:<nonce_hex>:<ciphertext_hex>".
 */
export async function encryptString(plaintext: string): Promise<string> {
  await ensureReady();
  const key = getEncryptionKey();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ct = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key);
  return `enc:v1:${sodium.to_hex(nonce)}:${sodium.to_hex(ct)}`;
}

/**
 * Decrypt a string from DB storage.
 * Accepts both encrypted ("enc:v1:...") and legacy plaintext.
 */
export async function decryptString(stored: string): Promise<string> {
  await ensureReady();
  if (!stored.startsWith("enc:v1:")) return stored; // legacy plaintext
  const parts = stored.split(":");
  if (parts.length !== 4) throw new Error("Malformed encrypted string");
  const nonce = sodium.from_hex(parts[2]);
  const ciphertext = sodium.from_hex(parts[3]);
  const key = getEncryptionKey();
  const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);
  return sodium.to_string(plaintext);
}
