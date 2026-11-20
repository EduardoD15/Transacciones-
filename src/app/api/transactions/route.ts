// validaciones de la API de transacciones, tanto para GET como para POST
// mas validaciones en colombian-date.ts y window-rules.ts y en security.ts(creacion de hash)
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { listTransactions, registerTransaction } from "@/lib/transaction-service";
import { isValidDateTime } from "@/lib/colombia-date";//validaciones

// Zod para validar estructura y tipos de datos
const transactionSchema = z.object({
  idTxn: z.union([z.string(), z.number()]).refine((value) => String(value).trim().length > 0),
  user: z.string().refine((value) => value.trim().length > 0),
  date: z.string().refine(isValidDateTime, {
    message: "Usa una fecha y hora ISO 8601 válida con Z, offset horario o sin zona.",
  }),
  value: z.number().finite(),
  paymentMethod: z.string(),
  hash: z.string().optional().default(""),

  ip: z.string().nullable().optional(),
});

const transactionBatchSchema = z.array(transactionSchema).min(1);//por si es un arreglo
const RAW_BODY_LOG_LIMIT = 4000;

function postResponse(
  requestId: string,
  payload: Record<string, unknown>,
  status = 200,
) {
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
  logger("POST /api/transactions received", {
    requestId,
    method: request.method,
    contentType: request.headers.get("content-type"),
  });

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al leer el body.";
    logger("POST /api/transactions body read failed", { requestId, message });
    return postResponse(requestId, {
      received: true,
      processed: false,
      error: "No fue posible leer el cuerpo de la solicitud.",
      details: message,
    }, 400);
  }

  logger("POST /api/transactions raw body captured", {
    requestId,
    bodyLength: rawBody.length,
    truncated: rawBody.length > RAW_BODY_LOG_LIMIT,
    body: rawBody.slice(0, RAW_BODY_LOG_LIMIT),
  });

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido al procesar JSON.";
    logger("POST /api/transactions invalid JSON", { requestId, message });
    return postResponse(requestId, {
      received: true,
      processed: false,
      error: "El cuerpo debe ser JSON válido.",
      details: message,
    }, 400);
  }

  const isBatch = Array.isArray(body);//si recibio un arreglo
  const parsedBody = isBatch
    ? transactionBatchSchema.safeParse(body)
    : transactionSchema.safeParse(body);
  if (!parsedBody.success) {
    const details = parsedBody.error.issues.map(({ path, code, message }) => ({
      path: path.length > 0 ? path.map(String).join(".") : "(body)",
      code,
      message,
    }));
    logger("POST /api/transactions validation failed", {
      requestId,
      bodyType: isBatch ? "array" : typeof body,
      details,
    });
    return postResponse(requestId, {
      received: true,
      processed: false,
      error: "La solicitud no tiene los campos requeridos.",
      details,
    }, 422); 
  }
  //varias transaciones 
  if (Array.isArray(parsedBody.data)) {
    const results = [];
    for (let index = 0; index < parsedBody.data.length; index += 1) {
      try {
        const result = await registerTransaction(parsedBody.data[index], { requestId, index });
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error inesperado.";
        logger("POST /api/transactions batch failed", {
          requestId,
          index,
          processedCount: results.length,
          message,
        });
        const status = /configur|falta configurar/i.test(message) ? 503 : 500;
        return postResponse(requestId, {
          error: message,
          failedIndex: index,
          processedCount: results.length,
          results,
        }, status);
      }
    }

    return postResponse(requestId, {
      message: "Todas las transacciones del lote fueron registradas y evaluadas.",
      total: results.length,
      results,
    }, 201);
  }

  //si es una sola transacción
  try {
    const result = await registerTransaction(parsedBody.data, { requestId });

    return postResponse(requestId, {
      message: "Transacción registrada y evaluada; las anomalías no bloquean el registro.",
      ...result,
    }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    logger("POST /api/transactions processing failed", { requestId, message });
    const status = /configur|falta configurar/i.test(message) ? 503 : 500;
    return postResponse(requestId, { error: message }, status);
  }
}
