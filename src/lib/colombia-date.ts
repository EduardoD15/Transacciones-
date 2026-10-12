const COLOMBIA_TIME_ZONE = "America/Bogota";
const COLOMBIA_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:-05:00)?$/;

export function isColombiaDateTime(value: string) {
  if (!COLOMBIA_DATE_TIME_PATTERN.test(value)) return false;
  return !Number.isNaN(new Date(withColombiaOffset(value)).getTime());
}

function withColombiaOffset(value: string) {
  return value.endsWith("-05:00") ? value : `${value}-05:00`;
}

export function toColombiaISOString(value: string) {
  const timestamp = value.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(value)
    ? new Date(value)
    : new Date(withColombiaOffset(value));

  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("La fecha debe ser una fecha y hora válida de Colombia.");
  }

  return timestamp.toISOString();
}

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
}
