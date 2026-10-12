export type PaymentMethod =
  | "Tarjeta"
  | "Nequi"
  | "PSE"
  | "Daviplata"
  | "Efectivo"
  | string;

export type TransactionStatus = "NORMAL";

export type AnomalyType =
  | "POTENTIAL_FRAUD"
  | "INVALID_HASH"
  | "DUPLICATE_ID";

export interface TransactionInput {
  idTxn: number | string;
  user: string;
  date: string;
  value: number;
  paymentMethod: string;
  hash: string;
  ip?: string | null;
}

export interface TransactionRecord extends TransactionInput {
  id: string;
  hashValid: boolean;
  status: TransactionStatus;
  createdAt: string;
  windowTransactions: number;
}

export interface AnomalyRecord {
  id: string;
  user: string;
  level: "LOW" | "MEDIUM" | "HIGH";
  type: AnomalyType;
  reason: string;
  status: string;
  windowTransactions: number;
  count: number;
  value: number;
  triggerId: string;
  transactions: TransactionRecord[];
  createdAt: string;
}

export interface DashboardSummary {
  totalTransactions: number;
  totalAnomalies: number;
  suspiciousRate: number;
  affectedUsers: number;
  totalSuspectValue: number;
  averageTransactionsPerUser: number;
  newAnomalies: number;
  openAnomalies: number;
  reviewedAnomalies: number;
  discardedAnomalies: number;
}
