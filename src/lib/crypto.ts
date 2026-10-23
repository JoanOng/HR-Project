/**
 * Bank-account field encryption at rest — AES-256-GCM.
 * Payload format: base64(iv[12] | ciphertext | tag[16]).
 * Key: ENCRYPTION_KEY env var, base64-encoded 32 bytes.
 * A key loss makes encrypted bank data unrecoverable — back it up.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

/** plaintext → base64 payload. Safe to store in the DB. */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
    "base64",
  );
}

/** payload → plaintext. Throws on tamper or wrong key. */
export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LEN + TAG_LEN + 1)
    throw new Error("malformed encryption payload");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/** "****1234" — the mask everyone except an explicit HR reveal sees. */
export function mask(plaintext: string): string {
  return "****" + plaintext.slice(-4);
}