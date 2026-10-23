/**
 * Bank account — encrypted at rest, masked everywhere except an explicit
 * HR reveal. Plaintext never goes to the audit log, never to a list,
 * never to a client that didn't ask for it.
 */
import { prisma } from "@/prisma/client";
import { ulid } from "ulid";
import { encrypt, decrypt, mask } from "@/lib/crypto";
import { writeAudit } from "./audit";

export interface BankInput {
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
  currency?: string;
}

/** POST: create. If the employee already has a bank account → update it
 *  (1:1 by design, and a second card for the same person is a new value,
 *  not a new row). */
export async function upsertBankAccount(employeeId: string, input: BankInput, actorId: string) {
  const existing = await prisma.bankAccount.findUnique({ where: { employeeId } });

  const account = await prisma.bankAccount.upsert({
    where: { employeeId },
    create: {
      id: ulid(),
      employeeId,
      bankName: input.bankName,
      accountNumberEnc: encrypt(input.accountNumber),
      accountHolderNameEnc: encrypt(input.accountHolderName),
      currency: input.currency ?? "SGD",
    },
    update: {
      bankName: input.bankName,
      accountNumberEnc: encrypt(input.accountNumber),
      accountHolderNameEnc: encrypt(input.accountHolderName),
      currency: input.currency ?? "SGD",
    },
  });

  // audit BEFORE/AFTER as masks — the log must never hold plaintext
  await writeAudit(
    actorId, "BankAccount", account.id,
    existing ? "BANK_UPDATE" : "BANK_CREATE",
    existing
      ? { accountNumber: mask(decrypt(existing.accountNumberEnc)), accountHolderName: mask(decrypt(existing.accountHolderNameEnc)), bankName: existing.bankName }
      : undefined,
    { accountNumber: mask(input.accountNumber), accountHolderName: mask(input.accountHolderName), bankName: input.bankName },
    employeeId,
  );

  return account;
}

/** Every ordinary read: decrypted only long enough to mask. */
export async function getBankMasked(employeeId: string) {
  const row = await prisma.bankAccount.findUnique({ where: { employeeId } });
  if (!row) return null;
  return {
    bankName: row.bankName,
    accountNumber: mask(decrypt(row.accountNumberEnc)),
    accountHolderName: mask(decrypt(row.accountHolderNameEnc)),
    currency: row.currency,
  };
}

/** The ONE place plaintext comes back. HR only (enforced by the route),
 *  and it always leaves a BANK_REVEAL row — who looked, and when. */
export async function revealBankAccount(employeeId: string, actorId: string) {
  const row = await prisma.bankAccount.findUnique({ where: { employeeId } });
  if (!row) return null;

  await writeAudit(actorId, "BankAccount", row.id, "BANK_REVEAL",
    undefined, { accountNumber: mask(decrypt(row.accountNumberEnc)) }, employeeId);

  return {
    bankName: row.bankName,
    accountNumber: decrypt(row.accountNumberEnc),
    accountHolderName: decrypt(row.accountHolderNameEnc),
    currency: row.currency,
  };
}