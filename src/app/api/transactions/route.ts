// validaciones de la API de transacciones, tanto para GET como para POST
// mas validaciones en colombian-date.ts y window-rules.ts y en security.ts(creacion de hash)
import { NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { listTransactions, registerTransaction } from "@/lib/transaction-service";
import { isColombiaDateTime } from "@/lib/colombia-date";//validaciones

// Zod para validar estructura y tipos de datos
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

const transactionBatchSchema = z.array(transactionSchema).min(1);//por si es un arreglo

// Manejar errores y responder con un mensaje adecuado, con ayuda del logger
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

  const isBatch = Array.isArray(body);//si recibio un arreglo
  const parsedBody = z.union([transactionSchema, transactionBatchSchema]).safeParse(body);
  if (!parsedBody.success) {
    const details = isBatch ? parsedBody.error.issues : parsedBody.error.flatten();
    return NextResponse.json(
      { error: "La solicitud no tiene los campos requeridos.", details },
      { status: 400 },
    );
  }
  //varias transaciones 
  if (Array.isArray(parsedBody.data)) {
    const results = [];
    for (let index = 0; index < parsedBody.data.length; index += 1) {
      try {
        const result = await registerTransaction(parsedBody.data[index]);
        results.push(result);
        logger("POST /api/transactions batch item processed", {
          index,
          transactionId: result.transaction.id,
          hashValid: result.hashValid,
          duplicateId: result.duplicateId,
          anomalyCount: result.anomalies.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error inesperado.";
        logger("POST /api/transactions batch failed", {
          index,
          processedCount: results.length,
          message,
        });
        const status = /configur|falta configurar/i.test(message) ? 503 : 500;
        return NextResponse.json(
          {
            error: message,
            failedIndex: index,
            processedCount: results.length,
            results,
          },
          { status },
        );
      }
    }

    return NextResponse.json(
      {
        message: "Todas las transacciones del lote fueron registradas y evaluadas.",
        total: results.length,
        results,
      },
      { status: 201 },
    );
  }

  //si es una sola transacción
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
