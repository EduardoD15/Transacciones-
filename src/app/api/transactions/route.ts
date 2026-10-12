import { NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { listTransactions, registerTransaction } from "@/lib/transaction-service";
import { isColombiaDateTime } from "@/lib/colombia-date";

const transactionSchema = z.object({
  idTxn: z.union([z.string(), z.number()]).refine((value) => String(value).trim().length > 0),
  user: z.string().trim().min(1),
  date: z.string().refine(isColombiaDateTime, {
    message: "Usa fecha y hora de Colombia, con o sin el sufijo -05:00.",
  }),
  value: z.number().finite(),
  paymentMethod: z.string(),
  hash: z.string().optional().default(""),
  ip: z.string().nullable().optional(),
});

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Error inesperado.";
  logger("API transactions error", { message });

  const status = /configur|falta configurar/i.test(message) ? 503 : 500;
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  try {
    const transactions = await listTransactions();
    return NextResponse.json({ transactions, total: transactions.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400 });
  }

  const parsedBody = transactionSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "La solicitud no tiene los campos requeridos.", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await registerTransaction(parsedBody.data);
    logger("POST /api/transactions processed", {
      transactionId: result.transaction.id,
      hashValid: result.hashValid,
      duplicateId: result.duplicateId,
      anomalyCount: result.anomalies.length,
    });

    return NextResponse.json(
      {
        message: "Transacción registrada y evaluada; las anomalías no bloquean el registro.",
        ...result,
      },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
