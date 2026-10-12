import { verifyTransactionHash } from "@/lib/security";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ANOMALY_MAX_SPAN_SECONDS } from "@/lib/anomaly-rules";
import { toColombiaISOString } from "@/lib/colombia-date";
import { getWindowRule } from "@/lib/window-rules";
import type {
  AnomalyRecord,
  AnomalyType,
  TransactionInput,
  TransactionRecord,
} from "@/lib/types";

type DatabaseTransaction = {
  id: string;
  usuario_id: number;
  id_txn: string;
  valor: number | string;
  fecha_txn: string;
  estado: string;
  hash: string;
  hash_valido: boolean;
  metodo_pago: string;
  ip: string | null;
  ventana_transacciones?: number;
  fecha_creacion: string;
  usuarios: { email: string } | null;
};

function failOnDatabaseError(error: { message: string } | null) {
  if (error) {
    throw new Error(`Error de Supabase: ${error.message}`);
  }
}

function mapTransaction(row: DatabaseTransaction): TransactionRecord {
  return {
    id: String(row.id),
    idTxn: row.id_txn,
    user: row.usuarios?.email ?? "",
    date: row.fecha_txn,
    value: Number(row.valor),
    paymentMethod: row.metodo_pago,
    hash: row.hash,
    hashValid: row.hash_valido,
    status: "NORMAL",
    createdAt: row.fecha_creacion,
    ip: row.ip,
    windowTransactions: row.ventana_transacciones ?? 3,
  };
}

function normalizeInput(input: TransactionInput): TransactionInput & { windowTransactions: number } {
  const date = toColombiaISOString(input.date);
  const windowTransactions = getWindowRule(date).transactions;
  return {
    idTxn: String(input.idTxn).trim(),
    user: input.user.trim().toLowerCase(),
    date,
    value: Number(input.value),
    paymentMethod: input.paymentMethod.trim(),
    hash: String(input.hash ?? "").trim(),
    ip: input.ip?.trim() || null,
    windowTransactions,
  };
}

async function createAnomaly(input: {
  userId: number;
  email: string;
  type: AnomalyType;
  level: "LOW" | "MEDIUM" | "HIGH";
  reason: string;
  count: number;
  value: number;
  triggerId: string;
  windowTransactions: number;
  transactions: TransactionRecord[];
}) {
  const supabase = getSupabaseAdmin();
  const { data: anomaly, error: anomalyError } = await supabase
    .from("anomalias")
    .insert({
      usuario_id: input.userId,
      usuario_email: input.email,
      transaccion_id: input.triggerId,
      tipo: input.type,
      nivel: input.level,
      razon: input.reason,
      cantidad_transacciones: input.count,
      ventana_transacciones: input.windowTransactions,
      valor_sospechoso: input.value,
      estado: "abierta",
    })
    .select("id, fecha_creacion")
    .single();

  failOnDatabaseError(anomalyError);
  if (!anomaly) {
    throw new Error("Supabase no devolvió la anomalía recién creada.");
  }

  const { error: linksError } = await supabase.from("anomalia_transacciones").insert(
    input.transactions.map((transaction) => ({
      anomalia_id: anomaly.id,
      transaccion_id: transaction.id,
      es_disparadora: transaction.id === input.triggerId,
    })),
  );
  failOnDatabaseError(linksError);

  return {
    id: anomaly.id,
    user: input.email,
    level: input.level,
    type: input.type,
    reason: input.reason,
    status: "abierta",
    windowTransactions: input.windowTransactions,
    count: input.count,
    value: input.value,
    triggerId: input.triggerId,
    transactions: input.transactions,
    createdAt: anomaly.fecha_creacion,
  } satisfies AnomalyRecord;
}

function findWindowContainingCurrent(
  transactions: TransactionRecord[],
  currentTransactionId: string,
  windowTransactions: number,
  maxSpanSeconds: number,
  timestampField: "date" | "createdAt",
) {
  const timestamp = (transaction: TransactionRecord) =>
    new Date(transaction[timestampField]).getTime();
  const sortedTransactions = [...transactions].sort(
    (left, right) => timestamp(left) - timestamp(right),
  );
  const triggerIndex = sortedTransactions.findIndex(
    (transaction) => transaction.id === currentTransactionId,
  );

  if (triggerIndex < 0) return null;

  const maxSpanMilliseconds = maxSpanSeconds * 1000;
  let bestWindow: TransactionRecord[] | null = null;
  const firstPossibleStart = Math.max(0, triggerIndex - windowTransactions + 1);

  for (let startIndex = firstPossibleStart; startIndex <= triggerIndex; startIndex += 1) {
    const endIndex = startIndex + windowTransactions - 1;
    if (endIndex >= sortedTransactions.length) continue;

    const startTimestamp = timestamp(sortedTransactions[startIndex]);
    const endTimestamp = timestamp(sortedTransactions[endIndex]);
    if (endTimestamp - startTimestamp > maxSpanMilliseconds) continue;

    const candidate = sortedTransactions.slice(startIndex, endIndex + 1);
    if (!bestWindow || endTimestamp - startTimestamp <
      timestamp(bestWindow[bestWindow.length - 1]) - timestamp(bestWindow[0])) {
      bestWindow = candidate;
    }
  }

  return bestWindow;
}

export async function listTransactions(): Promise<TransactionRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("transacciones")
    .select("*, usuarios(email)")
    .order("fecha_txn", { ascending: false })
    .limit(2000);

  failOnDatabaseError(error);
  return (data ?? []).map((row) => mapTransaction(row as DatabaseTransaction));
}

export async function listAnomalies(): Promise<AnomalyRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data: anomalyRows, error: anomalyError } = await supabase
    .from("anomalias")
    .select("*")
    .order("fecha_creacion", { ascending: false })
    .limit(2000);

  failOnDatabaseError(anomalyError);
  const anomalies = anomalyRows ?? [];
  if (anomalies.length === 0) return [];

  const { data: links, error: linksError } = await supabase
    .from("anomalia_transacciones")
    .select("anomalia_id, transaccion_id, es_disparadora")
    .in("anomalia_id", anomalies.map((anomaly) => anomaly.id));

  failOnDatabaseError(linksError);

  const transactions = await listTransactions();
  const transactionsById = new Map(transactions.map((transaction) => [transaction.id, transaction]));

  return anomalies.map((row) => {
    const anomalyTransactions = (links ?? [])
      .filter((link) => link.anomalia_id === row.id)
      .map((link) => transactionsById.get(String(link.transaccion_id)))
      .filter((transaction): transaction is TransactionRecord => Boolean(transaction))
      .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

    return {
      id: row.id,
      user: row.usuario_email,
      level: row.nivel,
      type: row.tipo,
      reason: row.razon,
      status: row.estado,
      windowTransactions: row.ventana_transacciones ?? 3,
      count: row.cantidad_transacciones,
      value: Number(row.valor_sospechoso),
      triggerId: String(row.transaccion_id),
      transactions: anomalyTransactions,
      createdAt: row.fecha_creacion,
    } satisfies AnomalyRecord;
  });
}

export async function registerTransaction(input: TransactionInput) {
  const transaction = normalizeInput(input);
  const hashValid = verifyTransactionHash(transaction);
  const windowTransactions = transaction.windowTransactions;
  const supabase = getSupabaseAdmin();

  const { data: user, error: userError } = await supabase
    .from("usuarios")
    .upsert(
      { email: transaction.user, nombre: transaction.user.split("@")[0], estado: "activo" },
      { onConflict: "email" },
    )
    .select("id")
    .single();
  failOnDatabaseError(userError);
  if (!user) {
    throw new Error("Supabase no devolvió el usuario creado o encontrado.");
  }

  const { data: existingRows, error: duplicateError } = await supabase
    .from("transacciones")
    .select("*, usuarios(email)")
    .eq("id_txn", String(transaction.idTxn))
    .order("fecha_creacion", { ascending: true });
  failOnDatabaseError(duplicateError);
  const existingTransactions = (existingRows ?? []).map((row) =>
    mapTransaction(row as DatabaseTransaction),
  );
  const duplicateId = existingTransactions.length > 0;

  const { data: insertedRow, error: insertError } = await supabase
    .from("transacciones")
    .insert({
      usuario_id: user.id,
      id_txn: String(transaction.idTxn),
      valor: transaction.value,
      fecha_txn: transaction.date,
      estado: "normal",
      hash: transaction.hash,
      hash_valido: hashValid,
      metodo_pago: transaction.paymentMethod,
      ip: transaction.ip ?? null,
      ventana_transacciones: windowTransactions,
    })
    .select("*, usuarios(email)")
    .single();
  failOnDatabaseError(insertError);
  if (!insertedRow) {
    throw new Error("Supabase no devolvió la transacción recién guardada.");
  }

  const savedTransaction = mapTransaction(insertedRow as DatabaseTransaction);
  const anomalies: AnomalyRecord[] = [];

  if (!hashValid) {
    anomalies.push(
      await createAnomaly({
        userId: user.id,
        email: transaction.user,
        type: "INVALID_HASH",
        level: "HIGH",
        reason: "El hash recibido no coincide con la clave secreta del sistema.",
        count: 1,
        value: transaction.value,
        triggerId: savedTransaction.id,
        windowTransactions,
        transactions: [savedTransaction],
      }),
    );
  }

  if (duplicateId) {
    const duplicateGroup = [...existingTransactions, savedTransaction];
    anomalies.push(
      await createAnomaly({
        userId: user.id,
        email: transaction.user,
        type: "DUPLICATE_ID",
        level: "HIGH",
        reason: `El idTxn ${transaction.idTxn} ya había sido recibido ${existingTransactions.length} vez/veces.`,
        count: duplicateGroup.length,
        value: duplicateGroup.reduce((sum, item) => sum + item.value, 0),
        triggerId: savedTransaction.id,
        windowTransactions,
        transactions: duplicateGroup,
      }),
    );
  }

  const dateTimestamp = new Date(transaction.date).getTime();
  const receivedTimestamp = new Date(savedTransaction.createdAt).getTime();
  const windowMilliseconds = ANOMALY_MAX_SPAN_SECONDS * 1000;
  const [eventTimeResult, receivedTimeResult] = await Promise.all([
    supabase
      .from("transacciones")
      .select("*, usuarios(email)")
      .eq("usuario_id", user.id)
      .gte("fecha_txn", new Date(dateTimestamp - windowMilliseconds).toISOString())
      .lte("fecha_txn", new Date(dateTimestamp + windowMilliseconds).toISOString())
      .order("fecha_txn", { ascending: true }),
    supabase
      .from("transacciones")
      .select("*, usuarios(email)")
      .eq("usuario_id", user.id)
      .gte("fecha_creacion", new Date(receivedTimestamp - windowMilliseconds).toISOString())
      .lte("fecha_creacion", new Date(receivedTimestamp + windowMilliseconds).toISOString())
      .order("fecha_creacion", { ascending: true }),
  ]);
  failOnDatabaseError(eventTimeResult.error);
  failOnDatabaseError(receivedTimeResult.error);

  const eventTimeWindow = findWindowContainingCurrent(
    (eventTimeResult.data ?? []).map((row) => mapTransaction(row as DatabaseTransaction)),
    savedTransaction.id,
    windowTransactions,
    ANOMALY_MAX_SPAN_SECONDS,
    "date",
  );
  const receivedTimeWindow = findWindowContainingCurrent(
    (receivedTimeResult.data ?? []).map((row) => mapTransaction(row as DatabaseTransaction)),
    savedTransaction.id,
    windowTransactions,
    ANOMALY_MAX_SPAN_SECONDS,
    "createdAt",
  );
  const detectedByReceivedTime =
    receivedTimeWindow !== null &&
    (!eventTimeWindow || receivedTimeWindow.length > eventTimeWindow.length);
  const window = detectedByReceivedTime ? receivedTimeWindow : eventTimeWindow;
  if (window) {
    anomalies.push(
      await createAnomaly({
        userId: user.id,
        email: transaction.user,
        type: "POTENTIAL_FRAUD",
        level: window.length >= 4 ? "HIGH" : "MEDIUM",
        reason: `Se detectaron ${windowTransactions} transacciones del usuario en ${ANOMALY_MAX_SPAN_SECONDS} segundos o menos por ${
          detectedByReceivedTime ? "tiempo de recepción de la API" : "fecha de transacción"
        }.`,
        count: windowTransactions,
        value: window.reduce((sum, item) => sum + item.value, 0),
        triggerId: savedTransaction.id,
        windowTransactions,
        transactions: window,
      }),
    );
  }

  return {
    transaction: savedTransaction,
    hashValid,
    duplicateId,
    anomalies,
  };
}
