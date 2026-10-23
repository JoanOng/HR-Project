import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { encrypt, decrypt, mask } from "../src/lib/crypto";

describe("bank field crypto", () => {
  const savedKey = process.env.ENCRYPTION_KEY;
  beforeAll(() => {
    // known test key — not a real secret
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  afterAll(() => {
    if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedKey;
  });

  it("round-trips", () => {
    const payload = encrypt("1234567890");
    expect(payload).not.toContain("1234567890"); // never plaintext at rest
    expect(decrypt(payload)).toBe("1234567890");
  });

  it("two encryptions of the same value differ (fresh IV)", () => {
    expect(encrypt("abc")).not.toBe(encrypt("abc"));
  });

  it("rejects tampered payloads", () => {
    const payload = Buffer.from(encrypt("abc"), "base64");
    payload[payload.length - 1] ^= 0xff; // flip a tag byte
    expect(() => decrypt(payload.toString("base64"))).toThrow();
  });

  it("masks to last 4", () => {
    expect(mask("1234567890")).toBe("****7890");
  });
});