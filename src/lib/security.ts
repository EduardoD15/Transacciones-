import crypto from "node:crypto";

import { toColombiaISOString } from "@/lib/colombia-date";
import type { TransactionInput } from "@/lib/types";

export function buildTransactionHash(transaction: TransactionInput): string {
  const payload = {
    idTxn: String(transaction.idTxn).trim(),
    user: String(transaction.user).trim().toLowerCase(),
    date: toColombiaISOString(transaction.date),
    value: Number(transaction.value),
    paymentMethod: String(transaction.paymentMethod).trim(),
  };

  const secret = process.env.TRANSACTION_SECRET;

  if (!secret) {
    throw new Error("Falta configurar TRANSACTION_SECRET en las variables de entorno.");
  }

  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

export function verifyTransactionHash(transaction: TransactionInput): boolean {
  if (!process.env.TRANSACTION_SECRET) {
    throw new Error("Falta configurar TRANSACTION_SECRET en las variables de entorno.");
  }

  const providedHash = String(transaction.hash ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(providedHash)) {
    return false;
  }

  const expectedHash = buildTransactionHash(transaction);
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  const providedBuffer = Buffer.from(providedHash, "hex");

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
