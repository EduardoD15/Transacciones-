import { verifyTransactionHash } from "@/lib/security";
import { logger } from "@/lib/logger";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ANOMALY_MAX_SPAN_SECONDS } from "@/lib/anomaly-rules";
import { toColombiaISOString } from "@/lib/colombia-date";
import { getWindowRule } from "@/lib/window-rules";
import type {
  AnomalyRecord,
  AnomalyStatus,
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

type TransactionLogContext = {
  requestId: string;
  index?: number;
};

async function runLoggedStep<T>(
  context: TransactionLogContext,
  step: string,
  operation: () => T,
): Promise<Awaited<T>> {
  const metadata = { ...context, step };
  logger("POST /api/transactions step started", metadata);
  try {
    const result = await operation();
    logger("POST /api/transactions step completed", metadata);
    return result;
  } catch (error) {
    logger("POST /api/transactions step failed", {
      ...metadata,
      message: error instanceof Error ? error.message : "Error inesperado.",
    });
    throw error;
  }
}

function failOnDatabaseError(
  error: { message: string } | null,
  logContext?: TransactionLogContext,
  step?: string,
) {
  if (error) {
    if (logContext) {
      logger("POST /api/transactions database operation failed", {
        ...logContext,
        step,
        message: error.message,
      });
    }
    throw new Error(`Error de Supabase: ${error.message}`);
  }
  if (logContext) {
    logger("POST /api/transactions database operation succeeded", {
      ...logContext,
      step,
    });
  }
}// si hay un error lanza un error con el mensaje de supabase

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

//normaliza los datos de entrada, convierte a string...
function normalizeInput(input: TransactionInput): TransactionInput & { windowTransactions: number } {
  const date = toColombiaISOString(input.date);
  const windowTransactions = getWindowRule(date).transactions;//obtiene la cantidad de transacciones permitidas en el periodo de tiempo

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

//crea la anomalia y la guarda en la base de datos, 
// ademas de crear los enlaces con las transacciones
async function createAnomaly(input: {
  logContext: TransactionLogContext;
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
  const supabase = await runLoggedStep(input.logContext, "create Supabase client for anomaly", () =>
    getSupabaseAdmin(),
  );
  const { data: anomaly, error: anomalyError } = await runLoggedStep(
    input.logContext,
    `insert anomaly ${input.type}`,
    () => supabase
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
      .single(),
  );

  failOnDatabaseError(anomalyError, input.logContext, `insert anomaly ${input.type}`);
  if (!anomaly) {
    logger("POST /api/transactions anomaly insert returned no row", {
      ...input.logContext,
      anomalyType: input.type,
    });
    throw new Error("Supabase no devolvió la anomalía recién creada.");
  }

  const { error: linksError } = await runLoggedStep(
    input.logContext,
    `link transactions to anomaly ${input.type}`,
    () => supabase.from("anomalia_transacciones").insert(
      input.transactions.map((transaction) => ({
        anomalia_id: anomaly.id,
        transaccion_id: transaction.id,
        es_disparadora: transaction.id === input.triggerId,
      })),
    ),
  );
  failOnDatabaseError(linksError, input.logContext, `link transactions to anomaly ${input.type}`);
  logger("POST /api/transactions anomaly saved", {
    ...input.logContext,
    anomalyType: input.type,
    transactionLinks: input.transactions.length,
  });

  return {
    id: String(anomaly.id),
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

//funcion para encontrar la ventana de transacciones que contiene 
//la transaccion actual
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
  );//ordena las transacciones por ordencronologico
  const triggerIndex = sortedTransactions.findIndex(
    (transaction) => transaction.id === currentTransactionId,
  );//ubica el indice de la transaccion actual en el arreglo 

  if (triggerIndex < 0) return null;

  const maxSpanMilliseconds = maxSpanSeconds * 1000;
  let bestWindow: TransactionRecord[] | null = null;//la mejor ventana encontrada hasta ahora
  const firstPossibleStart = Math.max(0, triggerIndex - windowTransactions + 1);//el primer indice posible para la ventana de transacciones

  //itera desde el primer indice posible hasta el indice de la transaccion actual
  for (let startIndex = firstPossibleStart; startIndex <= triggerIndex; startIndex += 1){
    const endIndex = startIndex + windowTransactions - 1;//el indice final de la ventana de transacciones
    if (endIndex >= sortedTransactions.length) continue;//si el indice final es mayor que la longitud del arreglo, continua con la siguiente iteracion

    const startTimestamp = timestamp(sortedTransactions[startIndex]);
    const endTimestamp = timestamp(sortedTransactions[endIndex]);
    if (endTimestamp - startTimestamp > maxSpanMilliseconds) continue;
    //si la diferencia entre el tiempo de la transaccion final y la inicial es mayor que el maximo permitido, continua con la siguiente iteracion

    const candidate = sortedTransactions.slice(startIndex, endIndex + 1);
    //la ventana de transacciones candidata
    if (!bestWindow || endTimestamp - startTimestamp <
      timestamp(bestWindow[bestWindow.length - 1]) - timestamp(bestWindow[0])) {
      bestWindow = candidate;
    }//si no hay una mejor ventana o la ventana candidata es mejor que la mejor encontrada hasta ahora, actualiza la mejor ventana
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
}//listar todas las transacciones, ordenadas por fecha de transaccion descendente, con un limite de 2000

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
      id: String(row.id),
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
}//listar todas las anomalias, ordenadas por fecha de creacion descendente, con un limite de 2000

export async function updateAnomalyStatus(
  anomalyId: string,
  status: AnomalyStatus,
): Promise<{ id: string; status: AnomalyStatus } | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("anomalias")
    .update({ estado: status })
    .eq("id", anomalyId)
    .select("id, estado")
    .maybeSingle();

  failOnDatabaseError(error);
  if (!data) return null;

  return { id: String(data.id), status };
}//actualiza el estado de una anomalia, devuelve el id y el estado actualizado, o null si no se encontro la anomalia


//registrar transaccion, valida el hash, verifica si es duplicada, crea anomalias si es necesario
export async function registerTransaction(
  input: TransactionInput,
  logContext: TransactionLogContext,
) {
  logger("POST /api/transactions normalizing transaction", {
    ...logContext,
    transactionId: input.idTxn,
  });
  const transaction = await runLoggedStep(logContext, "normalize transaction", () =>
    normalizeInput(input),
  );
  logger("POST /api/transactions transaction normalized", {
    ...logContext,
    transactionId: transaction.idTxn,
    windowTransactions: transaction.windowTransactions,
  });
  logger("POST /api/transactions validating HMAC", {
    ...logContext,
    transactionId: transaction.idTxn,
    hashLength: transaction.hash.length,
  });
  const hashValid = await runLoggedStep(logContext, "validate transaction HMAC", () =>
    verifyTransactionHash(transaction),
  );
  logger("POST /api/transactions HMAC validation completed", {
    ...logContext,
    transactionId: transaction.idTxn,
    hashValid,
  });
  const windowTransactions = transaction.windowTransactions;
  logger("POST /api/transactions connecting to Supabase", logContext);
  const supabase = await runLoggedStep(logContext, "create Supabase admin client", () =>
    getSupabaseAdmin(),
  );
  logger("POST /api/transactions Supabase client ready", logContext);

  const { data: user, error: userError } = await runLoggedStep(
    logContext,
    "upsert user",
    () => supabase
      .from("usuarios")
      .upsert(
        { email: transaction.user, nombre: transaction.user.split("@")[0], estado: "activo" },
        { onConflict: "email" },
      )
      .select("id")
      .single(),
  );
  failOnDatabaseError(userError, logContext, "upsert user");
  if (!user) {
    logger("POST /api/transactions user upsert returned no row", {
      ...logContext,
      transactionId: transaction.idTxn,
    });
    throw new Error("Supabase no devolvió el usuario creado o encontrado.");
  }

  const { data: existingRows, error: duplicateError } = await runLoggedStep(
    logContext,
    "check duplicate transaction ID",
    () => supabase
      .from("transacciones")
      .select("*, usuarios(email)")
      .eq("id_txn", String(transaction.idTxn))
      .order("fecha_creacion", { ascending: true }),
  );
  failOnDatabaseError(duplicateError, logContext, "check duplicate transaction ID");
  const existingTransactions = (existingRows ?? []).map((row) =>
    mapTransaction(row as DatabaseTransaction),
  );
  const duplicateId = existingTransactions.length > 0;
  logger("POST /api/transactions duplicate check completed", {
    ...logContext,
    transactionId: transaction.idTxn,
    duplicateId,
    matchingTransactions: existingTransactions.length,
  });

  const { data: insertedRow, error: insertError } = await runLoggedStep(
    logContext,
    "insert transaction",
    () => supabase
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
      .single(),
  );
  failOnDatabaseError(insertError, logContext, "insert transaction");
  if (!insertedRow) {
    logger("POST /api/transactions transaction insert returned no row", {
      ...logContext,
      transactionId: transaction.idTxn,
    });
    throw new Error("Supabase no devolvió la transacción recién guardada.");
  }

  const savedTransaction = mapTransaction(insertedRow as DatabaseTransaction);
  logger("POST /api/transactions transaction inserted", {
    ...logContext,
    transactionId: transaction.idTxn,
    databaseId: savedTransaction.id,
  });
  const anomalies: AnomalyRecord[] = [];

  if (!hashValid) {
    logger("POST /api/transactions recording invalid-hash anomaly", {
      ...logContext,
      transactionId: transaction.idTxn,
    });
    anomalies.push(
      await createAnomaly({
        logContext,
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
    logger("POST /api/transactions recording duplicate-ID anomaly", {
      ...logContext,
      transactionId: transaction.idTxn,
    });
    const duplicateGroup = [...existingTransactions, savedTransaction];
    anomalies.push(
      await createAnomaly({
        logContext,
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
  logger("POST /api/transactions querying anomaly windows", {
    ...logContext,
    transactionId: transaction.idTxn,
    maxSpanSeconds: ANOMALY_MAX_SPAN_SECONDS,
    windowTransactions,
  });
  const [eventTimeResult, receivedTimeResult] = await Promise.all([
    runLoggedStep(logContext, "query event-time anomaly window", () =>
      supabase
        .from("transacciones")
        .select("*, usuarios(email)")
        .eq("usuario_id", user.id)
        .gte("fecha_txn", new Date(dateTimestamp - windowMilliseconds).toISOString())
        .lte("fecha_txn", new Date(dateTimestamp + windowMilliseconds).toISOString())
        .order("fecha_txn", { ascending: true }),
    ),
    runLoggedStep(logContext, "query received-time anomaly window", () =>
      supabase
        .from("transacciones")
        .select("*, usuarios(email)")
        .eq("usuario_id", user.id)
        .gte("fecha_creacion", new Date(receivedTimestamp - windowMilliseconds).toISOString())
        .lte("fecha_creacion", new Date(receivedTimestamp + windowMilliseconds).toISOString())
        .order("fecha_creacion", { ascending: true }),
    ),
  ]);
  failOnDatabaseError(eventTimeResult.error, logContext, "query event-time anomaly window");
  failOnDatabaseError(receivedTimeResult.error, logContext, "query received-time anomaly window");
  logger("POST /api/transactions anomaly window queries completed", {
    ...logContext,
    eventTimeMatches: eventTimeResult.data?.length ?? 0,
    receivedTimeMatches: receivedTimeResult.data?.length ?? 0,
  });

  const { eventTimeWindow, receivedTimeWindow } = await runLoggedStep(
    logContext,
    "evaluate transaction anomaly windows",
    () => ({
      eventTimeWindow: findWindowContainingCurrent(
        (eventTimeResult.data ?? []).map((row) => mapTransaction(row as DatabaseTransaction)),
        savedTransaction.id,
        windowTransactions,
        ANOMALY_MAX_SPAN_SECONDS,
        "date",
      ),
      receivedTimeWindow: findWindowContainingCurrent(
        (receivedTimeResult.data ?? []).map((row) => mapTransaction(row as DatabaseTransaction)),
        savedTransaction.id,
        windowTransactions,
        ANOMALY_MAX_SPAN_SECONDS,
        "createdAt",
      ),
    }),
  );
  const detectedByReceivedTime =
    receivedTimeWindow !== null &&
    (!eventTimeWindow || receivedTimeWindow.length > eventTimeWindow.length);
  const window = detectedByReceivedTime ? receivedTimeWindow : eventTimeWindow;
  logger("POST /api/transactions anomaly evaluation completed", {
    ...logContext,
    transactionId: transaction.idTxn,
    detectedByReceivedTime,
    eventTimeWindowSize: eventTimeWindow?.length ?? 0,
    receivedTimeWindowSize: receivedTimeWindow?.length ?? 0,
    anomalyDetected: Boolean(window),
  });
  if (window) {
    logger("POST /api/transactions recording potential-fraud anomaly", {
      ...logContext,
      transactionId: transaction.idTxn,
      windowSize: window.length,
      detectedByReceivedTime,
    });
    anomalies.push(
      await createAnomaly({
        logContext,
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

  logger("POST /api/transactions transaction registration completed", {
    ...logContext,
    transactionId: transaction.idTxn,
    databaseId: savedTransaction.id,
    hashValid,
    duplicateId,
    anomalyCount: anomalies.length,
  });
  return {
    transaction: savedTransaction,
    hashValid,
    duplicateId,
    anomalies,
  };
}//registrar transaccion, valida el hash, verifica si es duplicada, crea anomalias si es necesario
