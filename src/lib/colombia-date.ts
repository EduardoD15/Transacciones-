//zona horaria de colombia, validaciones de fecha y hora,
// conversion a formato ISO 8601
const COLOMBIA_TIME_ZONE = "America/Bogota";
const COLOMBIA_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:-05:00)?$/;//formato estricto de la fecha

export function isColombiaDateTime(value: string) {
  if (!COLOMBIA_DATE_TIME_PATTERN.test(value)) return false;
  return !Number.isNaN(new Date(withColombiaOffset(value)).getTime());
}//verifica si la fecha es válida y tiene el formato correcto, con o sin el sufijo

function withColombiaOffset(value: string) {
  return value.endsWith("-05:00") ? value : `${value}-05:00`;
}//agrega el sufijo -05:00 si no está presente

export function toColombiaISOString(value: string) {
  const timestamp = value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value)
    ? new Date(value)
    : new Date(withColombiaOffset(value));

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("La fecha debe ser una fecha y hora válida de Colombia.");
  }

  return timestamp.toISOString();
}//convierte la fecha a formato ISO 8601, agregando el sufijo -05:00 si no está presente

export function colombiaClock(value: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    timeZone: COLOMBIA_TIME_ZONE,
  }).formatToParts(new Date(toColombiaISOString(value)));
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const second = parts.find((part) => part.type === "second")?.value;
  if (hour === undefined || minute === undefined || second === undefined) {
    throw new Error("No fue posible determinar la hora de Colombia.");
  }
  return { hour: Number(hour), minute: Number(minute), second: Number(second) };
}//devuelve la hora, minuto y segundo de la fecha en hora de Colombia
