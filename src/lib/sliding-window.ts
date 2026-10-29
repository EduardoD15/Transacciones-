
import crypto from "node:crypto";

import { ANOMALY_MAX_SPAN_SECONDS } from "@/lib/anomaly-rules";
import type { AnomalyRecord, TransactionRecord } from "@/lib/types";

export function detectSlidingWindowAnomalies(
  transactions: TransactionRecord[],//recibe la cantidad de transacciones
  windowTransactions = 3,//cantidad de transacciones que se permiten en la ventana de tiempo
): AnomalyRecord[] {
  const transactionsByUser = new Map<string, TransactionRecord[]>();
  //mapa para agrupar las transacciones por usuario

  //ordenar las transacciones por usuario y por fecha, para poder aplicar la ventana deslizante
  transactions.forEach((transaction) => {
    const current = transactionsByUser.get(transaction.user) ?? [];
    current.push(transaction);
    current.sort(
      (left, right) =>
        new Date(left.date).getTime() - new Date(right.date).getTime(),
    );
    transactionsByUser.set(transaction.user, current);
  });

  const anomalies: AnomalyRecord[] = [];

  //aplicar la ventana deslizante para detectar anomalias
  transactionsByUser.forEach((userTransactions, user) => {
    const slidingWindow: TransactionRecord[] = [];

    userTransactions.forEach((transaction) => {
      slidingWindow.push(transaction);

      while (slidingWindow.length > 0) {
        const oldestTransaction = slidingWindow[0];//la transaccion mas antigua en la ventana
        const oldestTimestamp = new Date(oldestTransaction.date).getTime();
        const newestTimestamp = new Date(transaction.date).getTime();
        const deltaSeconds = (newestTimestamp - oldestTimestamp) / 1000;
        // calcula la diferencia en segundos entre la transaccion mas reciente y la mas antigua en la ventana


        if (deltaSeconds <= ANOMALY_MAX_SPAN_SECONDS) {
          break;
        }//si la diferencia es menor o igual al maximo permitido, sal del bucle

        slidingWindow.shift();//si la diferencia es mayor al maximo permitido, elimina la transaccion mas antigua de la ventana
      }

      if (slidingWindow.length >= windowTransactions) {//si la ventana de transacciones es mayor o igual a la cantidad permitida, crea una anomalia y agrega a la lista de anomalias
        const matchingWindow = slidingWindow.slice(-windowTransactions);
        const value = matchingWindow.reduce(
          (total, item) => total + Number(item.value),
          0,
        );//calcula el valor total de las transacciones en la ventana

        anomalies.push({
          id: crypto.randomUUID(),
          user,
          level: windowTransactions >= 10 ? "HIGH" : "MEDIUM",
          type: "POTENTIAL_FRAUD",
          reason: `Se detectaron ${windowTransactions} transacciones del usuario en ${ANOMALY_MAX_SPAN_SECONDS} segundos o menos.`,
          status: "abierta",
          windowTransactions,
          count: windowTransactions,
          value,
          triggerId: transaction.id,
          transactions: matchingWindow,
          createdAt: new Date().toISOString(),
        });//si la ventana de transacciones es mayor o igual a la cantidad permitida, crea una anomalia y agrega a la lista de anomalias
      }
    });
  });

  return anomalies;
}
