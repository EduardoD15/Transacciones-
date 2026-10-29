//construye hash y lo verifica, comparacion
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
    .createHmac("sha256", secret)//crea el objeto
    .update(JSON.stringify(payload), "utf8")//con el body de la transacción lo convierte en texto
    .digest("hex");//nos da el resuldado final del hash
}

export function verifyTransactionHash(transaction: TransactionInput): boolean {
  if (!process.env.TRANSACTION_SECRET) {
    throw new Error("Falta configurar TRANSACTION_SECRET en las variables de entorno.");
  }

  const providedHash = String(transaction.hash ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(providedHash)) {
    return false;
  }//el hash que nos da el cliente o desde otra parte , se convierte en minisculas

  const expectedHash = buildTransactionHash(transaction);
  const expectedBuffer = Buffer.from(expectedHash, "hex");//servidor
  const providedBuffer = Buffer.from(providedHash, "hex");//cliente

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);//comparacion de hash por medio de bytes
}
