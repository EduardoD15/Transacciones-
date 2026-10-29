// validaciones de la API de transacciones, tanto para GET como para POST
// mas validaciones en colombian-date.ts y window-rules.ts y en security.ts(creacion de hash)
import { randomUUID } from "node:crypto";
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

function postResponse(
  requestId: string,
  startedAt: number,
  stage: string,
  payload: Record<string, unknown>,
  status = 200,
) {
  logger("POST /api/transactions response sent", {
    requestId,
    stage,
    status,
    durationMs: Date.now() - startedAt,
  });
  return NextResponse.json({ requestId, ...payload }, { status });
}

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
  const requestId = randomUUID();
  const startedAt = Date.now();
  logger("POST /api/transactions received", {
    requestId,
    method: request.method,
    contentType: request.headers.get("content-type"),
  });

  let body: unknown;
  try {
    logger("POST /api/transactions reading JSON body", { requestId });
    body = await request.json();
    logger("POST /api/transactions body parsed", {
      requestId,
      bodyType: Array.isArray(body) ? "array" : typeof body,
      keys: body !== null && typeof body === "object" && !Array.isArray(body)
        ? Object.keys(body)
        : undefined,
      itemCount: Array.isArray(body) ? body.length : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al leer JSON.";
    logger("POST /api/transactions invalid JSON", { requestId, message });
    return postResponse(requestId, startedAt, "invalid-json", {
      received: true,
      processed: false,
      error: "El cuerpo debe ser JSON válido.",
      details: message,
    });
  }

  const isBatch = Array.isArray(body);//si recibio un arreglo
  logger("POST /api/transactions validation started", {
    requestId,
    schema: isBatch ? "transaction batch" : "single transaction",
  });
  const parsedBody = isBatch
    ? transactionBatchSchema.safeParse(body)
    : transactionSchema.safeParse(body);
  if (!parsedBody.success) {
    const details = parsedBody.error.issues.map(({ path, code, message }) => ({
      path,
      code,
      message,
    }));
    logger("POST /api/transactions validation failed", {
      requestId,
      bodyType: isBatch ? "array" : typeof body,
      details,
    });
    return postResponse(requestId, startedAt, "validation-failed", {
      received: true,
      processed: false,
      error: "La solicitud no tiene los campos requeridos.",
      details,
    });
  }
  logger("POST /api/transactions validation passed", {
    requestId,
    transactionCount: Array.isArray(parsedBody.data) ? parsedBody.data.length : 1,
  });

  //varias transaciones 
  if (Array.isArray(parsedBody.data)) {
    const results = [];
    logger("POST /api/transactions batch processing started", {
      requestId,
      total: parsedBody.data.length,
    });
    for (let index = 0; index < parsedBody.data.length; index += 1) {
      try {
        logger("POST /api/transactions batch item registering", {
          requestId,
          index,
          transactionId: parsedBody.data[index].idTxn,
        });
        const result = await registerTransaction(parsedBody.data[index], { requestId, index });
        results.push(result);
        logger("POST /api/transactions batch item processed", {
          requestId,
          index,
          transactionId: result.transaction.id,
          hashValid: result.hashValid,
          duplicateId: result.duplicateId,
          anomalyCount: result.anomalies.length,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error inesperado.";
        logger("POST /api/transactions batch failed", {
          requestId,
          index,
          processedCount: results.length,
          message,
        });
        const status = /configur|falta configurar/i.test(message) ? 503 : 500;
        return postResponse(requestId, startedAt, "batch-item-failed", {
          error: message,
          failedIndex: index,
          processedCount: results.length,
          results,
        }, status);
      }
    }

    logger("POST /api/transactions batch processing completed", {
      requestId,
      processedCount: results.length,
    });
    return postResponse(requestId, startedAt, "batch-completed", {
      message: "Todas las transacciones del lote fueron registradas y evaluadas.",
      total: results.length,
      results,
    }, 201);
  }

  //si es una sola transacción
  try {
    logger("POST /api/transactions registering", {
      requestId,
      transactionId: parsedBody.data.idTxn,
      hashLength: parsedBody.data.hash.length,
    });
    const result = await registerTransaction(parsedBody.data, { requestId });
    logger("POST /api/transactions processed", {
      requestId,
      transactionId: result.transaction.id,
      hashValid: result.hashValid,
      duplicateId: result.duplicateId,
      anomalyCount: result.anomalies.length,
    });

    return postResponse(requestId, startedAt, "transaction-processed", {
      message: "Transacción registrada y evaluada; las anomalías no bloquean el registro.",
      ...result,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    logger("POST /api/transactions processing failed", { requestId, message });
    const status = /configur|falta configurar/i.test(message) ? 503 : 500;
    return postResponse(requestId, startedAt, "processing-failed", { error: message }, status);
  }
}
