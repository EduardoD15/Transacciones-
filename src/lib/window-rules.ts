//validaciones de la ventana de tiempo
import { colombiaClock } from "@/lib/colombia-date";

export type WindowPeriod = "morning" | "afternoon" | "night";

export interface WindowRule {
  period: WindowPeriod;//mañana, tarde-noche, noche-madrugada
  transactions: number;//cantidad de transacciones permitidas en el periodo
  label: string;
}

function readPositiveInteger(name: string, legacyName: string, fallback: number) {
  const value = Number(process.env[name] ?? process.env[legacyName] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} debe ser un entero positivo.`);
  }
  return value;
}//lee la variable de entorno y valida que sea un entero positivo, si no lo es lanza un error

export function getWindowRule(dateTime: string): WindowRule {
  if (Number.isNaN(new Date(dateTime).getTime())) {
    throw new Error("La fecha debe ser ISO 8601 e incluir una hora válida.");
  } //valida que la fecha sea válida

  const { hour, minute, second } = colombiaClock(dateTime);
  const timeOfDay = hour * 3600 + minute * 60 + second;//convierte la hora a segundos desde la medianoche
  const morningWindow = readPositiveInteger(
    "WINDOW_MORNING_TRANSACTIONS",
    "WINDOW_MORNING_SECONDS",
    10,
  );
  const afternoonWindow = readPositiveInteger(
    "WINDOW_AFTERNOON_TRANSACTIONS",
    "WINDOW_AFTERNOON_SECONDS",
    6,
  );
  const nightWindow = readPositiveInteger(
    "WINDOW_NIGHT_TRANSACTIONS",
    "WINDOW_NIGHT_SECONDS",
    3,
  );

  if (timeOfDay >= 5 * 3600 + 1 && timeOfDay <= 12 * 3600) {
    return { period: "morning", transactions: morningWindow, label: "Mañana" };
  }
  if (timeOfDay >= 12 * 3600 + 1 && timeOfDay <= 20 * 3600) {
    return { period: "afternoon", transactions: afternoonWindow, label: "Tarde-noche" };
  }
  return { period: "night", transactions: nightWindow, label: "Noche-madrugada" };
}
