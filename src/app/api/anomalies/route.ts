import { NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { listAnomalies, updateAnomalyStatus } from "@/lib/transaction-service";

const updateAnomalySchema = z.object({
  id: z.union([
    z.string().trim().min(1),
    z.number().int().positive().transform(String),
  ]),
  status: z.enum(["abierta", "revisada", "descartada"]),
});

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

export async function PATCH(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON válido." }, { status: 400 });
  }

  const parsedBody = updateAnomalySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "Indica un ID y un estado válido para la anomalía.", details: parsedBody.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const anomaly = await updateAnomalyStatus(parsedBody.data.id, parsedBody.data.status);
    if (!anomaly) {
      return NextResponse.json({ error: "No se encontró la anomalía indicada." }, { status: 404 });
    }

    logger("PATCH /api/anomalies status updated", anomaly);
    return NextResponse.json({ anomaly });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado.";
    logger("PATCH /api/anomalies error", { message });
    const status = /configur|falta configurar/i.test(message) ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
