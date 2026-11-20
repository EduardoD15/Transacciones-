//Validación ISO 8601 y normalización de instantes a UTC.
//Colombia se usa únicamente para decidir la ventana horaria de negocio.
const COLOMBIA_TIME_ZONE = "America/Bogota";
const ISO_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

export function isValidDateTime(value: string) {
  if (!ISO_DATE_TIME_PATTERN.test(value)) return false;
  return !Number.isNaN(new Date(withUTCDesignator(value)).getTime());
}//verifica si la fecha ISO 8601 es válida

function withUTCDesignator(value: string) {
  if (value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value)) return value;
  return value.includes("T") ? `${value}Z` : `${value}T00:00:00Z`;
}//interpreta fechas sin zona como UTC

export function toUTCISOString(value: string) {
  const timestamp = new Date(withUTCDesignator(value));

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("La fecha debe ser una fecha ISO 8601 válida.");
  }

  return timestamp.toISOString();
}//normaliza el instante UTC para almacenarlo

export function colombiaClock(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    timeZone: COLOMBIA_TIME_ZONE,
  }).formatToParts(new Date(toUTCISOString(value)));
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const second = parts.find((part) => part.type === "second")?.value;
  if (hour === undefined || minute === undefined || second === undefined) {
    throw new Error("No fue posible determinar la hora de Colombia.");
  }
  return { hour: Number(hour), minute: Number(minute), second: Number(second) };
}//devuelve la hora, minuto y segundo de la fecha en hora de Colombia
