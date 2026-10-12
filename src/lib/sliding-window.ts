import crypto from "node:crypto";

import { ANOMALY_MAX_SPAN_SECONDS } from "@/lib/anomaly-rules";
import type { AnomalyRecord, TransactionRecord } from "@/lib/types";

export function detectSlidingWindowAnomalies(
  transactions: TransactionRecord[],
  windowTransactions = 3,
): AnomalyRecord[] {
  const transactionsByUser = new Map<string, TransactionRecord[]>();

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

  transactionsByUser.forEach((userTransactions, user) => {
    const slidingWindow: TransactionRecord[] = [];

    userTransactions.forEach((transaction) => {
      slidingWindow.push(transaction);

      while (slidingWindow.length > 0) {
        const oldestTransaction = slidingWindow[0];
        const oldestTimestamp = new Date(oldestTransaction.date).getTime();
        const newestTimestamp = new Date(transaction.date).getTime();
        const deltaSeconds = (newestTimestamp - oldestTimestamp) / 1000;

        if (deltaSeconds <= ANOMALY_MAX_SPAN_SECONDS) {
          break;
        }

        slidingWindow.shift();
      }

      if (slidingWindow.length >= windowTransactions) {
        const matchingWindow = slidingWindow.slice(-windowTransactions);
        const value = matchingWindow.reduce(
          (total, item) => total + Number(item.value),
          0,
        );

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
        });
      }
    });
  });

  return anomalies;
}
