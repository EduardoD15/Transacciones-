"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { ANOMALY_MAX_SPAN_SECONDS } from "@/lib/anomaly-rules";
import type { AnomalyRecord, AnomalyType, TransactionRecord } from "@/lib/types";

type Filters = {
  user: string;
  idTxn: string;
  paymentMethod: string;
  anomalyType: AnomalyType | "";
  startDate: string;
  endDate: string;
  minValue: string;
};

type DashboardPeriod = "today" | "week" | "month" | "year" | "all";
type DashboardPeriodSelection = {
  kind: "day" | "days" | "week" | "month" | "year" | "all";
  date: string;
  fromDate: string;
  toDate: string;
};

const emptyFilters: Filters = {
  user: "",
  idTxn: "",
  paymentMethod: "",
  anomalyType: "",
  startDate: "",
  endDate: "",
  minValue: "",
};

const money = (value: number) =>
  `$${Number(value).toLocaleString("es-CO", { maximumFractionDigits: 2 })}`;

const dateTime = (value: string) =>
  new Date(value).toLocaleString("es-CO", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "America/Bogota",
  });

function transactionMatches(transaction: TransactionRecord, filters: Filters) {
  const user = filters.user.trim().toLowerCase();
  const paymentMethod = filters.paymentMethod.trim().toLowerCase();
  const minimum = filters.minValue === "" ? null : Number(filters.minValue);
  const start = filters.startDate ? new Date(`${filters.startDate}T00:00:00`).getTime() : null;
  const end = filters.endDate
    ? new Date(`${filters.endDate}T23:59:59.999`).getTime()
    : null;
  const timestamp = new Date(transaction.date).getTime();

  return (
    (!user || transaction.user.toLowerCase().includes(user)) &&
    (!filters.idTxn || String(transaction.idTxn).includes(filters.idTxn.trim())) &&
    (!paymentMethod || transaction.paymentMethod.toLowerCase().includes(paymentMethod)) &&
    (start === null || timestamp >= start) &&
    (end === null || timestamp <= end) &&
    (minimum === null || transaction.value >= minimum)
  );
}

function periodStart(period: DashboardPeriod, currentTime: number) {
  if (period === "all" || currentTime === 0) return null;
  const now = new Date(currentTime);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (period === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  } else if (period === "month") {
    start.setDate(1);
  } else if (period === "year") {
    start.setMonth(0, 1);
  }

  return start.getTime();
}

function matchesPeriod(date: string, period: DashboardPeriod, currentTime: number) {
  const start = periodStart(period, currentTime);
  const timestamp = new Date(date).getTime();
  return start === null || (timestamp >= start && timestamp <= currentTime);
}

function localDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function periodRange(selection: DashboardPeriodSelection) {
  if (selection.kind === "all") return null;
  if (selection.kind === "days") {
    const start = localDate(selection.fromDate);
    const end = localDate(selection.toDate);
    if (!start || !end || start > end) return { start: Infinity, end: -Infinity };
    end.setDate(end.getDate() + 1);
    return { start: start.getTime(), end: end.getTime() - 1 };
  }

  if (selection.kind === "year") {
    const year = Number(selection.date);
    if (!Number.isInteger(year) || year < 1900 || year > 9999) {
      return { start: Infinity, end: -Infinity };
    }
    return {
      start: new Date(year, 0, 1).getTime(),
      end: new Date(year + 1, 0, 1).getTime() - 1,
    };
  }

  const selectedDate =
    selection.kind === "month"
      ? localDate(`${selection.date}-01`)
      : localDate(selection.date);
  if (!selectedDate) return { start: Infinity, end: -Infinity };

  if (selection.kind === "month") {
    return {
      start: new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1).getTime(),
      end: new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1).getTime() - 1,
    };
  }
  const start = new Date(selectedDate);
  if (selection.kind === "week") {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.getTime(), end: end.getTime() - 1 };
  }

  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() - 1 };
}

function matchesDashboardPeriod(date: string, selection: DashboardPeriodSelection) {
  const range = periodRange(selection);
  if (!range) return true;
  const timestamp = new Date(date).getTime();
  return timestamp >= range.start && timestamp <= range.end;
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dashboardPeriodLabel(selection: DashboardPeriodSelection) {
  if (selection.kind === "all") return "General";
  if (selection.kind === "days") {
    return selection.fromDate && selection.toDate
      ? `Días: ${selection.fromDate} – ${selection.toDate}`
      : "Selecciona el rango de días";
  }
  if (selection.kind === "week") return `Semana de ${selection.date || "—"}`;
  if (selection.kind === "month") return `Mes: ${selection.date || "—"}`;
  if (selection.kind === "year") return `Año: ${selection.date || "—"}`;
  return `Día: ${selection.date || "—"}`;
}

function FilterControls({
  filters,
  onChange,
  onClear,
}: {
  filters: Filters;
  onChange: (filters: Filters) => void;
  onClear: () => void;
}) {
  const update = (key: keyof Filters, value: string) => onChange({ ...filters, [key]: value });
  const inputClass =
    "min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none";

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <input
        aria-label="Filtrar por usuario"
        className={inputClass}
        onChange={(event) => update("user", event.target.value)}
        placeholder="Usuario / correo"
        value={filters.user}
      />
      <input
        aria-label="Filtrar por ID de transacción"
        className={inputClass}
        onChange={(event) => update("idTxn", event.target.value)}
        placeholder="ID de transacción"
        value={filters.idTxn}
      />
      <input
        aria-label="Filtrar por método de pago"
        className={inputClass}
        onChange={(event) => update("paymentMethod", event.target.value)}
        placeholder="Método de pago"
        value={filters.paymentMethod}
      />
      <select
        aria-label="Filtrar por tipo de anomalía"
        className={inputClass}
        onChange={(event) => update("anomalyType", event.target.value)}
        value={filters.anomalyType}
      >
        <option value="">Todos los tipos</option>
        <option value="DUPLICATE_ID">DUPLICATE_ID</option>
        <option value="POTENTIAL_FRAUD">POTENTIAL_FRAUD</option>
        <option value="INVALID_HASH">INVALID_HASH</option>
      </select>
      <input
        aria-label="Filtrar por valor mínimo"
        className={inputClass}
        min="0"
        onChange={(event) => update("minValue", event.target.value)}
        placeholder="Valor mínimo"
        type="number"
        value={filters.minValue}
      />
      <label className="flex items-center gap-2 text-xs text-slate-400">
        Desde
        <input
          aria-label="Fecha inicial"
          className={inputClass}
          onChange={(event) => update("startDate", event.target.value)}
          type="date"
          value={filters.startDate}
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-slate-400">
        Hasta
        <input
          aria-label="Fecha final"
          className={inputClass}
          onChange={(event) => update("endDate", event.target.value)}
          type="date"
          value={filters.endDate}
        />
      </label>
      <button
        className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-cyan-500 hover:text-white"
        onClick={onClear}
        type="button"
      >
        Limpiar filtros y período
      </button>
    </div>
  );
}

function TablePagination({
  label,
  page,
  pageSize,
  total,
  onPageChange,
}: {
  label: string;
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const firstResult = total === 0 ? 0 : currentPage * pageSize + 1;
  const lastResult = Math.min((currentPage + 1) * pageSize, total);

  return (
    <nav aria-label={`Paginación de ${label}`} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-slate-400">
        {firstResult}–{lastResult} de {total}
      </span>
      <div className="flex items-center gap-2">
        <button
          aria-label={`Página anterior de ${label}`}
          className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 transition enabled:hover:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
          type="button"
        >
          Anterior
        </button>
        <span className="min-w-24 text-center text-slate-400">
          Página {currentPage + 1} de {pageCount}
        </span>
        <button
          aria-label={`Página siguiente de ${label}`}
          className="rounded-lg border border-slate-700 px-3 py-2 text-slate-200 transition enabled:hover:border-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={currentPage >= pageCount - 1}
          onClick={() => onPageChange(currentPage + 1)}
          type="button"
        >
          Siguiente
        </button>
      </div>
    </nav>
  );
}

function AnomalyDetails({ anomaly }: { anomaly: AnomalyRecord }) {
  const usesReceivedTime = anomaly.reason.includes("tiempo de recepción de la API");
  const transactionTimestamp = (transaction: TransactionRecord) =>
    new Date(usesReceivedTime ? transaction.createdAt : transaction.date).getTime();
  const orderedTransactions = [...anomaly.transactions].sort(
    (left, right) => transactionTimestamp(left) - transactionTimestamp(right),
  );
  const durationSeconds =
    orderedTransactions.length < 2
      ? 0
      : (transactionTimestamp(orderedTransactions[orderedTransactions.length - 1]) -
          transactionTimestamp(orderedTransactions[0])) /
        1000;

  return (
    <>
      <div className="rounded-lg border border-slate-700 bg-slate-950/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-cyan-200">
            Ventana aplicada: {anomaly.windowTransactions} transacciones en {ANOMALY_MAX_SPAN_SECONDS} s o menos
          </span>
          <span className="text-slate-400">
            {usesReceivedTime ? "Lapso desde recepción API" : "Lapso entre fechas de transacción"}:{" "}
            {durationSeconds.toFixed(3)} s · {anomaly.count} transacciones evaluadas
          </span>
        </div>
        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
          {orderedTransactions.map((transaction, index) => {
            const isTrigger = transaction.id === anomaly.triggerId;
            return (
              <div className="flex shrink-0 items-center gap-2" key={transaction.id}>
                {index > 0 ? <span className="h-px w-5 bg-slate-600" /> : null}
                <div
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    isTrigger
                      ? "border-rose-400 bg-rose-950 text-rose-100"
                      : "border-slate-700 bg-slate-900 text-slate-300"
                  }`}
                >
                  <p className="font-mono">{transaction.idTxn}</p>
                  <p className="mt-1">Transacción: {dateTime(transaction.date)}</p>
                  <p className="mt-1">Recibida: {dateTime(transaction.createdAt)}</p>
                  <p className="mt-1">{isTrigger ? "Disparó alerta" : "En ventana"}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="bg-slate-950 text-slate-400">
            <tr>
              <th className="p-2">Marca</th>
              <th className="p-2">ID transacción</th>
              <th className="p-2">Usuario</th>
              <th className="p-2">Fecha y hora</th>
              <th className="p-2">Valor</th>
              <th className="p-2">Método</th>
              <th className="p-2">Ventana</th>
              <th className="p-2">Hash</th>
            </tr>
          </thead>
          <tbody>
            {anomaly.transactions.map((transaction) => {
              const isTrigger = transaction.id === anomaly.triggerId;
              return (
                <tr
                  className={isTrigger ? "bg-rose-950/70 text-rose-100" : "border-t border-slate-800 text-slate-300"}
                  key={transaction.id}
                >
                  <td className="p-2 font-semibold">{isTrigger ? "ALERTA" : "En ventana"}</td>
                  <td className="p-2 font-mono">{transaction.idTxn}</td>
                  <td className="p-2">{transaction.user}</td>
                  <td className="p-2">{dateTime(transaction.date)}</td>
                  <td className="p-2">{money(transaction.value)}</td>
                  <td className="p-2">{transaction.paymentMethod}</td>
                  <td className="p-2">{transaction.windowTransactions} transacciones</td>
                  <td className="p-2">{transaction.hashValid ? "Válido" : "Inválido"}</td>
                </tr>
              );
            })}
            {anomaly.transactions.length === 0 ? (
              <tr>
                <td className="p-3 text-slate-500" colSpan={8}>
                  No se encontraron transacciones asociadas a esta anomalía.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function requestDashboardData(): Promise<{
  transactions: TransactionRecord[];
  anomalies: AnomalyRecord[];
}> {
  const [transactionResponse, anomalyResponse] = await Promise.all([
    fetch("/api/transactions", { cache: "no-store" }),
    fetch("/api/anomalies", { cache: "no-store" }),
  ]);
  const [transactionData, anomalyData] = await Promise.all([
    transactionResponse.json(),
    anomalyResponse.json(),
  ]);

  if (!transactionResponse.ok || !anomalyResponse.ok) {
    throw new Error(
      transactionData.error ?? anomalyData.error ?? "No fue posible cargar los datos.",
    );
  }

  return {
    transactions: transactionData.transactions,
    anomalies: anomalyData.anomalies,
  };
}

export function Dashboard() {
  const pageSize = 5;
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRecord[]>([]);
  const [anomalyPage, setAnomalyPage] = useState(0);
  const [transactionPage, setTransactionPage] = useState(0);
  const [expandedAnomalies, setExpandedAnomalies] = useState<Set<string>>(
    () => new Set(),
  );
  const [tableFilters, setTableFilters] = useState(emptyFilters);
  const [dashboardPeriod, setDashboardPeriod] = useState<DashboardPeriodSelection>({
    kind: "all",
    date: "",
    fromDate: "",
    toDate: "",
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const data = await requestDashboardData();
      setTransactions(data.transactions);
      setAnomalies(data.anomalies);
      setCurrentTime(Date.now());
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Error al cargar el dashboard.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void requestDashboardData()
      .then((data) => {
        if (!active) return;
        setTransactions(data.transactions);
        setAnomalies(data.anomalies);
        setCurrentTime(Date.now());
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(
            error instanceof Error ? error.message : "Error al cargar el dashboard.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const scopedTransactions = useMemo(
    () =>
      transactions.filter((transaction) =>
        matchesDashboardPeriod(transaction.date, dashboardPeriod),
      ),
    [transactions, dashboardPeriod],
  );

  const scopedAnomalies = useMemo(
    () =>
      anomalies.filter((anomaly) => {
        const trigger = anomaly.transactions.find(
          (transaction) => transaction.id === anomaly.triggerId,
        );
        return matchesDashboardPeriod(trigger?.date ?? anomaly.createdAt, dashboardPeriod);
      }),
    [anomalies, dashboardPeriod],
  );

  const anomalousTransactionIds = useMemo(() => {
    const ids = new Set<string>();
    scopedAnomalies.forEach((anomaly) => {
      anomaly.transactions.forEach((transaction) => {
        ids.add(transaction.id);
      });
    });
    return ids;
  }, [scopedAnomalies]);

  const filteredTransactions = useMemo(
    () =>
      scopedTransactions.filter(
        (transaction) =>
          !anomalousTransactionIds.has(transaction.id) &&
          transactionMatches(transaction, tableFilters),
      ),
    [scopedTransactions, tableFilters, anomalousTransactionIds],
  );

  const hasOtherTableFilters = Boolean(
    tableFilters.user ||
      tableFilters.idTxn ||
      tableFilters.paymentMethod ||
      tableFilters.startDate ||
      tableFilters.endDate ||
      tableFilters.minValue,
  );

  const filteredAnomalies = useMemo(
    () =>
      scopedAnomalies.filter((anomaly) => {
        if (tableFilters.anomalyType && anomaly.type !== tableFilters.anomalyType) {
          return false;
        }
        if (!hasOtherTableFilters) return true;
        return anomaly.transactions.some(
          (transaction) =>
            matchesDashboardPeriod(transaction.date, dashboardPeriod) &&
            transactionMatches(transaction, tableFilters),
        );
      }),
    [scopedAnomalies, tableFilters, dashboardPeriod, hasOtherTableFilters],
  );

  const relatedAnomalyLabels = useMemo(() => {
    const labelsByTransaction = new Map<
      string,
      { types: Set<AnomalyRecord["type"]>; levels: Set<AnomalyRecord["level"]> }
    >();
    scopedAnomalies.forEach((anomaly) => {
      anomaly.transactions.forEach((transaction) => {
        const labels = labelsByTransaction.get(transaction.id) ?? {
          types: new Set<AnomalyRecord["type"]>(),
          levels: new Set<AnomalyRecord["level"]>(),
        };
        labels.types.add(anomaly.type);
        labels.levels.add(anomaly.level);
        labelsByTransaction.set(transaction.id, labels);
      });
    });

    return new Map(
      scopedAnomalies.map((anomaly) => {
        const types = new Set<AnomalyRecord["type"]>([anomaly.type]);
        const levels = new Set<AnomalyRecord["level"]>([anomaly.level]);
        anomaly.transactions.forEach((transaction) => {
          const labels = labelsByTransaction.get(transaction.id);
          labels?.types.forEach((type) => types.add(type));
          labels?.levels.forEach((level) => levels.add(level));
        });
        return [anomaly.id, { types: [...types], levels: [...levels] }] as const;
      }),
    );
  }, [scopedAnomalies]);

  const currentAnomalyPage = Math.min(
    anomalyPage,
    Math.max(0, Math.ceil(filteredAnomalies.length / pageSize) - 1),
  );
  const currentTransactionPage = Math.min(
    transactionPage,
    Math.max(0, Math.ceil(filteredTransactions.length / pageSize) - 1),
  );
  const visibleAnomalies = filteredAnomalies.slice(
    currentAnomalyPage * pageSize,
    (currentAnomalyPage + 1) * pageSize,
  );
  const visibleTransactions = filteredTransactions.slice(
    currentTransactionPage * pageSize,
    (currentTransactionPage + 1) * pageSize,
  );

  const summary = useMemo(() => {
    const affectedUsers = new Set(scopedAnomalies.map((anomaly) => anomaly.user));
    const suspectTransactions = new Map(
      scopedAnomalies.flatMap((anomaly) =>
        anomaly.transactions.map((transaction) => [transaction.id, transaction] as const),
      ),
    );
    const byPaymentMethod = new Map<string, number>();
    const hourlyAnomalies = new Map<string, number>();
    const recurrentUsers = new Map<string, number>();
    const recurrentCases = new Map<string, { name: string; count: number; type: string }>();
    const dailyTrend = new Map<string, { transactions: number; anomalies: number }>();

    scopedAnomalies.forEach((anomaly) => {
      recurrentUsers.set(anomaly.user, (recurrentUsers.get(anomaly.user) ?? 0) + 1);
      const caseKey = `${anomaly.type}:${anomaly.reason}`;
      const recurringCase = recurrentCases.get(caseKey);
      recurrentCases.set(caseKey, {
        name: anomaly.reason,
        type: anomaly.type,
        count: (recurringCase?.count ?? 0) + 1,
      });
      const trigger =
        anomaly.transactions.find((transaction) => transaction.id === anomaly.triggerId) ??
        anomaly.transactions[anomaly.transactions.length - 1];
      if (trigger) {
        const hour = String(new Date(trigger.date).getHours()).padStart(2, "0");
        hourlyAnomalies.set(hour, (hourlyAnomalies.get(hour) ?? 0) + 1);
        const dateKey = new Date(trigger.date).toLocaleDateString("en-CA");
        const day = dailyTrend.get(dateKey) ?? { transactions: 0, anomalies: 0 };
        day.anomalies += 1;
        dailyTrend.set(dateKey, day);
      }
    });

    scopedTransactions.forEach((transaction) => {
      const suspect = suspectTransactions.has(transaction.id);
      if (suspect) {
        byPaymentMethod.set(
          transaction.paymentMethod,
          (byPaymentMethod.get(transaction.paymentMethod) ?? 0) + 1,
        );
      }
      const dateKey = new Date(transaction.date).toLocaleDateString("en-CA");
      const day = dailyTrend.get(dateKey) ?? { transactions: 0, anomalies: 0 };
      day.transactions += 1;
      dailyTrend.set(dateKey, day);
    });

    const totalUsers = new Set(scopedTransactions.map((item) => item.user)).size;
    const countForPeriod = (period: DashboardPeriod) => {
      const periodTransactions = transactions.filter((transaction) =>
        matchesPeriod(transaction.date, period, currentTime),
      );
      const ids = new Set(periodTransactions.map((transaction) => transaction.id));
      const periodAnomalies = anomalies.filter((anomaly) => {
        const trigger = anomaly.transactions.find((transaction) => transaction.id === anomaly.triggerId);
        return matchesPeriod(trigger?.date ?? anomaly.createdAt, period, currentTime);
      });
      return {
        transactions: periodTransactions.length,
        anomalies: periodAnomalies.length,
        involved: new Set(
          periodAnomalies.flatMap((anomaly) =>
            anomaly.transactions.filter((transaction) => ids.has(transaction.id)).map((transaction) => transaction.id),
          ),
        ).size,
      };
    };
    const anomalyTrend = [...dailyTrend.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(-14)
      .map(([date, values]) => ({ date, ...values }));

    return {
      totalTransactions: scopedTransactions.length,
      totalAnomalies: scopedAnomalies.length,
      suspiciousRate: scopedTransactions.length
        ? Math.round((new Set([...suspectTransactions.keys()].filter((id) =>
            scopedTransactions.some((transaction) => transaction.id === id),
          )).size / scopedTransactions.length) * 10000) / 100
        : 0,
      affectedUsers: affectedUsers.size,
      suspectValue: scopedTransactions
        .filter((transaction) => suspectTransactions.has(transaction.id))
        .reduce((total, transaction) => total + transaction.value, 0),
      averagePerUser: totalUsers
        ? Math.round((scopedTransactions.length / totalUsers) * 100) / 100
        : 0,
      multipleTransactionCases: scopedAnomalies.filter((anomaly) => anomaly.type === "POTENTIAL_FRAUD").length,
      invalidHashes: scopedAnomalies.filter((anomaly) => anomaly.type === "INVALID_HASH").length,
      duplicateIds: scopedAnomalies.filter((anomaly) => anomaly.type === "DUPLICATE_ID").length,
      newAnomalies: scopedAnomalies.filter((anomaly) =>
        matchesDashboardPeriod(anomaly.createdAt, dashboardPeriod),
      ).length,
      openAnomalies: scopedAnomalies.filter((anomaly) => anomaly.status === "abierta").length,
      reviewedAnomalies: scopedAnomalies.filter((anomaly) => anomaly.status === "revisada").length,
      discardedAnomalies: scopedAnomalies.filter((anomaly) => anomaly.status === "descartada").length,
      levels: {
        HIGH: scopedAnomalies.filter((anomaly) => anomaly.level === "HIGH").length,
        MEDIUM: scopedAnomalies.filter((anomaly) => anomaly.level === "MEDIUM").length,
        LOW: scopedAnomalies.filter((anomaly) => anomaly.level === "LOW").length,
      },
      periods: [
        { id: "today" as const, label: "Hoy", ...countForPeriod("today") },
        { id: "week" as const, label: "Esta semana", ...countForPeriod("week") },
        { id: "month" as const, label: "Este mes", ...countForPeriod("month") },
        { id: "year" as const, label: "Este año", ...countForPeriod("year") },
        { id: "all" as const, label: "General", ...countForPeriod("all") },
      ],
      byPaymentMethod: [...byPaymentMethod].sort((left, right) => right[1] - left[1]),
      hourlyAnomalies: Array.from({ length: 24 }, (_, hour) => {
        const label = String(hour).padStart(2, "0");
        return { hour: label, count: hourlyAnomalies.get(label) ?? 0 };
      }),
      recurrentUsers: [...recurrentUsers]
        .filter(([, count]) => count > 1)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5),
      recurrentCases: [...recurrentCases.values()]
        .sort((left, right) => right.count - left.count)
        .slice(0, 5),
      anomalyTrend,
    };
  }, [anomalies, currentTime, dashboardPeriod, scopedAnomalies, scopedTransactions, transactions]);

  const statCards = [
    { label: "Transacciones recibidas", value: summary.totalTransactions },
    { label: "Anomalías registradas", value: summary.totalAnomalies },
    { label: "Transacciones involucradas", value: `${summary.suspiciousRate}%` },
    { label: "Usuarios afectados", value: summary.affectedUsers },
    { label: "Valor relacionado", value: money(summary.suspectValue) },
    { label: "Promedio por usuario", value: summary.averagePerUser },
  ];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 border-b border-slate-800 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.28em] text-cyan-400">Appresso</p>
            <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">
              Monitor de transacciones
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              Detección de patrones, integridad HMAC y seguimiento de anomalías.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs text-cyan-200">
              Cantidad por ventana: mañana {process.env.NEXT_PUBLIC_WINDOW_MORNING_TRANSACTIONS ?? process.env.NEXT_PUBLIC_WINDOW_MORNING_SECONDS ?? "10"} ·
              tarde-noche {process.env.NEXT_PUBLIC_WINDOW_AFTERNOON_TRANSACTIONS ?? process.env.NEXT_PUBLIC_WINDOW_AFTERNOON_SECONDS ?? "6"} ·
              noche-madrugada {process.env.NEXT_PUBLIC_WINDOW_NIGHT_TRANSACTIONS ?? process.env.NEXT_PUBLIC_WINDOW_NIGHT_SECONDS ?? "3"} ·
              mismo usuario, en {ANOMALY_MAX_SPAN_SECONDS} s o menos
            </span>
            <button
              className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-500"
              onClick={() => void refresh()}
              type="button"
            >
              Actualizar
            </button>
          </div>
        </header>

        {loadError ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-950/40 p-4 text-sm text-amber-100">
            <span>{loadError}</span>
            <span className="text-amber-200/75">Configura Supabase y las variables de entorno para consultar los datos.</span>
          </div>
        ) : null}

        <section aria-label="Filtro global por período" className="mb-5 rounded-xl border border-cyan-900/60 bg-slate-900 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">Período del dashboard</h2>
              <p className="mt-1 text-xs text-slate-400">
                Elige un período y una fecha. Afecta las métricas y ambas tablas; los filtros inferiores refinan esos resultados.
              </p>
            </div>
            <span className="text-xs text-cyan-300">
              {dashboardPeriodLabel(dashboardPeriod)}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-xs text-slate-400">
              Tipo de período
              <select
                className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                onChange={(event) => {
                  const kind = event.target.value as DashboardPeriodSelection["kind"];
                  const today = dateInputValue(new Date());
                  setDashboardPeriod((current) => ({
                    kind,
                    date: kind === "year" ? today.slice(0, 4) : today,
                    fromDate: kind === "days" ? today : current.fromDate,
                    toDate: kind === "days" ? today : current.toDate,
                  }));
                }}
                value={dashboardPeriod.kind}
              >
                <option value="day">Un día</option>
                <option value="days">Rango de días</option>
                <option value="week">Una semana</option>
                <option value="month">Un mes</option>
                <option value="year">Un año</option>
                <option value="all">General</option>
              </select>
            </label>
            {dashboardPeriod.kind === "day" || dashboardPeriod.kind === "week" ? (
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                {dashboardPeriod.kind === "day" ? "Día" : "Elige un día de la semana"}
                <input
                  aria-label={dashboardPeriod.kind === "day" ? "Día del dashboard" : "Día de la semana"}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  onChange={(event) =>
                    setDashboardPeriod((current) => ({ ...current, date: event.target.value }))
                  }
                  type="date"
                  value={dashboardPeriod.date}
                />
              </label>
            ) : null}
            {dashboardPeriod.kind === "days" ? (
              <>
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Desde
                  <input
                    aria-label="Día inicial del período"
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    onChange={(event) =>
                      setDashboardPeriod((current) => ({ ...current, fromDate: event.target.value }))
                    }
                    type="date"
                    value={dashboardPeriod.fromDate}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-slate-400">
                  Hasta
                  <input
                    aria-label="Día final del período"
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                    onChange={(event) =>
                      setDashboardPeriod((current) => ({ ...current, toDate: event.target.value }))
                    }
                    type="date"
                    value={dashboardPeriod.toDate}
                  />
                </label>
              </>
            ) : null}
            {dashboardPeriod.kind === "month" ? (
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Mes
                <input
                  aria-label="Mes del dashboard"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  onChange={(event) =>
                    setDashboardPeriod((current) => ({ ...current, date: event.target.value }))
                  }
                  type="month"
                  value={dashboardPeriod.date.slice(0, 7)}
                />
              </label>
            ) : null}
            {dashboardPeriod.kind === "year" ? (
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                Año
                <input
                  aria-label="Año del dashboard"
                  className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  max="9999"
                  min="1900"
                  onChange={(event) =>
                    setDashboardPeriod((current) => ({ ...current, date: event.target.value }))
                  }
                  placeholder="AAAA"
                  type="number"
                  value={dashboardPeriod.date}
                />
              </label>
            ) : null}
          </div>
          <p className="mb-2 text-xs text-slate-500">Resumen por período; estas tarjetas no cambian el filtro seleccionado.</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {summary.periods.map((period) => (
              <article
                className="rounded-lg border border-slate-700 bg-slate-950 p-3"
                key={period.id}
              >
                <span className="block text-sm font-semibold text-white">{period.label}</span>
                <span className="mt-2 block text-xs text-slate-400">
                  {period.transactions} transacciones · {period.anomalies} anomalías
                </span>
                <span className="mt-1 block text-xs text-rose-300">
                  {period.involved} transacciones involucradas
                </span>
              </article>
            ))}
          </div>
        </section>

        <section aria-label="Resumen" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {statCards.map((card) => (
            <article className="rounded-xl border border-slate-800 bg-slate-900 p-4" key={card.label}>
              <p className="text-xs uppercase tracking-wide text-slate-400">{card.label}</p>
              <p className="mt-2 break-words text-2xl font-bold text-white">{card.value}</p>
            </article>
          ))}
        </section>

        <section aria-label="Estado y nivel de anomalías" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Anomalías nuevas en período", value: summary.newAnomalies },
            { label: "Abiertas", value: summary.openAnomalies },
            { label: "Revisadas", value: summary.reviewedAnomalies },
            { label: "Descartadas", value: summary.discardedAnomalies },
          ].map((item) => (
            <article className="rounded-xl border border-slate-800 bg-slate-900 p-4" key={item.label}>
              <p className="text-xs uppercase tracking-wide text-slate-400">{item.label}</p>
              <p className="mt-2 text-2xl font-bold text-white">{item.value}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Anomalías por tipo</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-400">Ventana sospechosa</span><b>{summary.multipleTransactionCases}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">Hash inválido</span><b className="text-amber-300">{summary.invalidHashes}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">ID repetido</span><b className="text-orange-300">{summary.duplicateIds}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">Nivel alto</span><b className="text-rose-300">{summary.levels.HIGH}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">Nivel medio</span><b className="text-amber-300">{summary.levels.MEDIUM}</b></div>
              <div className="flex justify-between"><span className="text-slate-400">Nivel bajo</span><b className="text-cyan-300">{summary.levels.LOW}</b></div>
            </div>
          </article>
          <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Métodos en anomalías</h2>
            <div className="mt-4 space-y-2">
              {summary.byPaymentMethod.slice(0, 5).map(([method, count]) => (
                <div className="flex items-center gap-3 text-xs" key={method}>
                  <span className="w-24 truncate text-slate-400">{method}</span>
                  <span className="h-2 flex-1 rounded bg-slate-800">
                    <span className="block h-2 rounded bg-cyan-500" style={{ width: `${Math.max(8, (count / Math.max(1, summary.byPaymentMethod[0]?.[1])) * 100)}%` }} />
                  </span>
                  <b className="w-6 text-right">{count}</b>
                </div>
              ))}
              {summary.byPaymentMethod.length === 0 ? <p className="text-sm text-slate-500">Aún no hay datos.</p> : null}
            </div>
          </article>
          <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Distribución de anomalías por hora</h2>
            <div className="mt-4 flex h-20 items-end gap-1">
              {summary.hourlyAnomalies.map(({ hour, count }) => (
                <div className="flex h-full flex-1 flex-col items-center justify-end gap-1" key={hour} title={`${hour}:00 — ${count} anomalías`}>
                  <span
                    className={`w-full rounded-t ${count > 0 ? "bg-rose-400/80" : "bg-slate-800"}`}
                    style={{ height: `${Math.max(5, (count / Math.max(1, ...summary.hourlyAnomalies.map((item) => item.count))) * 100)}%` }}
                  />
                  {Number(hour) % 3 === 0 ? <span className="text-[9px] text-slate-500">{hour}</span> : null}
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-3">
          <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Casos más recurrentes</h2>
            <div className="mt-4 space-y-3">
              {summary.recurrentCases.map((item) => (
                <div className="flex items-start justify-between gap-3 text-xs" key={`${item.type}:${item.name}`}>
                  <span className="text-slate-400">{item.name}</span>
                  <b className="shrink-0 rounded-full bg-cyan-950 px-2 py-1 text-cyan-200">{item.count}</b>
                </div>
              ))}
              {!summary.recurrentCases.length ? <p className="text-sm text-slate-500">Aún no hay casos registrados.</p> : null}
            </div>
            <p className="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-500">
              Casos de múltiples transacciones: {summary.multipleTransactionCases}
            </p>
          </article>

          <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Usuarios recurrentes</h2>
            <div className="mt-4 space-y-3">
              {summary.recurrentUsers.map(([user, count]) => (
                <div className="flex justify-between gap-3 text-sm" key={user}>
                  <span className="truncate text-slate-300">{user}</span>
                  <b className="text-amber-200">{count} casos</b>
                </div>
              ))}
              {!summary.recurrentUsers.length ? <p className="text-sm text-slate-500">Aún no hay usuarios con anomalías recurrentes.</p> : null}
            </div>
          </article>

          <article className="rounded-xl border border-slate-800 bg-slate-900 p-5">
            <h2 className="text-sm font-semibold text-slate-200">Tendencia diaria</h2>
            <p className="mt-1 text-xs text-slate-500">Últimos 14 días con actividad del período seleccionado.</p>
            <div className="mt-4 flex h-24 items-end gap-1">
              {summary.anomalyTrend.map((day) => {
                const peak = day.anomalies > 0 &&
                  day.anomalies === Math.max(...summary.anomalyTrend.map((item) => item.anomalies));
                return (
                  <div
                    className="flex h-full min-w-2 flex-1 flex-col items-center justify-end gap-1"
                    key={day.date}
                    title={`${day.date}: ${day.transactions} transacciones, ${day.anomalies} anomalías`}
                  >
                    <span
                      className={`w-full rounded-t ${peak ? "bg-rose-300" : "bg-cyan-600"}`}
                      style={{ height: `${Math.max(5, (day.anomalies / Math.max(1, ...summary.anomalyTrend.map((item) => item.anomalies))) * 100)}%` }}
                    />
                    <span className="text-[8px] text-slate-500">{day.date.slice(5)}</span>
                  </div>
                );
              })}
              {!summary.anomalyTrend.length ? <p className="self-center text-sm text-slate-500">Aún no hay actividad en el período.</p> : null}
            </div>
            <p className="mt-3 text-xs text-slate-500">Los picos rojos indican días con más anomalías.</p>
          </article>
        </section>

        <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="text-xl font-semibold text-white">Filtros compartidos de tablas</h2>
              <p className="mt-1 text-xs text-slate-400">
                Se aplican a anomalías y transacciones dentro del período global seleccionado.
              </p>
            </div>
            <p className="text-xs text-cyan-300">
              {dashboardPeriodLabel(dashboardPeriod)}
            </p>
          </div>
          <FilterControls
            filters={tableFilters}
            onChange={setTableFilters}
            onClear={() => {
              setTableFilters(emptyFilters);
              setDashboardPeriod({
                kind: "all",
                date: "",
                fromDate: "",
                toDate: "",
              });
              setAnomalyPage(0);
              setTransactionPage(0);
            }}
          />
        </section>

        <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold text-white">Anomalías</h2>
            <p className="text-sm text-slate-400">{filteredAnomalies.length} resultado(s)</p>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b border-slate-700 text-xs uppercase text-slate-400">
                <tr>
                  <th className="p-3">ID anomalía</th>
                  <th className="p-3">ID txn disparadora</th>
                  <th className="p-3">Usuario</th>
                  <th className="p-3">Tipo / nivel</th>
                  <th className="p-3">Cantidad</th>
                  <th className="p-3">Ventana elegida</th>
                  <th className="p-3">Valor relacionado</th>
                  <th className="p-3">Fecha</th>
                  <th className="p-3">Transacciones involucradas</th>
                </tr>
              </thead>
              <tbody>
                {visibleAnomalies.map((anomaly) => (
                  <Fragment key={anomaly.id}>
                  <tr
                    aria-expanded={expandedAnomalies.has(anomaly.id)}
                    className={`border-b border-slate-800 align-top ${
                      expandedAnomalies.has(anomaly.id) ? "bg-slate-800/50" : ""
                    }`}
                  >
                    <td className="p-3 font-mono text-xs text-slate-400" title={anomaly.id}>{anomaly.id}</td>
                    <td className="p-3 font-mono text-rose-200">
                      {anomaly.transactions.find((transaction) => transaction.id === anomaly.triggerId)?.idTxn ?? "—"}
                    </td>
                    <td className="p-3">{anomaly.user}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {relatedAnomalyLabels.get(anomaly.id)?.types.map((type) => (
                          <span
                            className={`rounded-full px-2 py-1 text-xs ${
                              type === "POTENTIAL_FRAUD"
                                ? "bg-rose-500/15 text-rose-200"
                                : type === "DUPLICATE_ID"
                                  ? "bg-orange-500/15 text-orange-200"
                                  : "bg-amber-500/15 text-amber-200"
                            }`}
                            key={type}
                          >
                            {type}
                          </span>
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {relatedAnomalyLabels.get(anomaly.id)?.levels.map((level) => (
                          <span
                            className="rounded-full bg-slate-700 px-2 py-1 text-xs text-slate-300"
                            key={level}
                          >
                            {level}
                          </span>
                        ))}
                      </div>
                      <p className="mt-1 max-w-xs text-xs text-slate-400">{anomaly.reason}</p>
                    </td>
                    <td className="p-3">{anomaly.count}</td>
                    <td className="p-3">{anomaly.windowTransactions} transacciones</td>
                    <td className="p-3">{money(anomaly.value)}</td>
                    <td className="p-3 whitespace-nowrap text-slate-300">{dateTime(anomaly.createdAt)}</td>
                    <td className="p-3">
                      <button
                        aria-controls={`anomaly-details-${anomaly.id}`}
                        aria-expanded={expandedAnomalies.has(anomaly.id)}
                        className="whitespace-nowrap text-cyan-300 hover:text-cyan-100"
                        onClick={() => {
                          setExpandedAnomalies((current) => {
                            const next = new Set(current);
                            if (next.has(anomaly.id)) next.delete(anomaly.id);
                            else next.add(anomaly.id);
                            return next;
                          });
                        }}
                        type="button"
                      >
                        {expandedAnomalies.has(anomaly.id)
                          ? "Ocultar transacciones ▴"
                          : `Desplegar ${anomaly.count} transacciones ▾`}
                      </button>
                    </td>
                  </tr>
                  {expandedAnomalies.has(anomaly.id) ? (
                    <tr className="border-b-2 border-cyan-900 bg-slate-950/50">
                      <td className="p-3" colSpan={9}>
                        <div
                          className="ml-3 border-l-2 border-cyan-500 pl-4"
                          id={`anomaly-details-${anomaly.id}`}
                        >
                          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-cyan-300">
                            Detalle de la anomalía {anomaly.id}
                          </p>
                          <AnomalyDetails anomaly={anomaly} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                ))}
                {!loading && filteredAnomalies.length === 0 ? (
                  <tr><td className="p-6 text-center text-slate-500" colSpan={9}>No hay anomalías que coincidan con los filtros.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <TablePagination
            label="anomalías"
            onPageChange={setAnomalyPage}
            page={currentAnomalyPage}
            pageSize={pageSize}
            total={filteredAnomalies.length}
          />
        </section>

        <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900 p-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold text-white">Transacciones</h2>
            <p className="text-sm text-slate-400">{filteredTransactions.length} resultado(s)</p>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="border-b border-slate-700 text-xs uppercase text-slate-400">
                <tr>
                  <th className="p-3">ID txn</th>
                  <th className="p-3">Usuario</th>
                  <th className="p-3">Fecha y hora</th>
                  <th className="p-3">Ventana</th>
                  <th className="p-3">Valor</th>
                  <th className="p-3">Método de pago</th>
                  <th className="p-3">IP</th>
                  <th className="p-3">Hash</th>
                  <th className="p-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibleTransactions.map((transaction) => (
                  <tr className="border-b border-slate-800 text-slate-200" key={transaction.id}>
                    <td className="p-3 font-mono">{transaction.idTxn}</td>
                    <td className="p-3">{transaction.user}</td>
                    <td className="p-3 whitespace-nowrap">{dateTime(transaction.date)}</td>
                    <td className="p-3">{transaction.windowTransactions} transacciones</td>
                    <td className="p-3">{money(transaction.value)}</td>
                    <td className="p-3">{transaction.paymentMethod}</td>
                    <td className="p-3">{transaction.ip || "—"}</td>
                    <td className="p-3">{transaction.hashValid ? "Válido" : "Inválido"}</td>
                    <td className="p-3">
                      <div className="flex min-w-32 flex-wrap gap-1">
                        <span className="whitespace-nowrap rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300">
                          NORMAL
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && filteredTransactions.length === 0 ? (
                  <tr><td className="p-6 text-center text-slate-500" colSpan={9}>No hay transacciones que coincidan con los filtros.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <TablePagination
            label="transacciones"
            onPageChange={setTransactionPage}
            page={currentTransactionPage}
            pageSize={pageSize}
            total={filteredTransactions.length}
          />
        </section>

        {loading ? <p className="mt-5 text-center text-sm text-slate-500">Cargando datos…</p> : null}
        <p className="mt-6 text-xs text-slate-500">
          Las transacciones con anomalías se guardan; una alerta no hace que el POST sea rechazado.
        </p>
      </div>
    </main>
  );
}
