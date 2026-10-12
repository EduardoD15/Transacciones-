import { NextResponse } from "next/server";

import { logger } from "@/lib/logger";
import { listAnomalies } from "@/lib/transaction-service";

export async function GET() {
  try {
    const anomalies = await listAnomalies();
    return NextResponse.json({ anomalies, total: anomalies.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    logger("GET /api/anomalies error", { message });
    const status = /configur|falta configurar/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
