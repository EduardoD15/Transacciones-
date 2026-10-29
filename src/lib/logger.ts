export function logger(message: string, metadata?: unknown) {
  console.info(`[Appresso] ${message}`, metadata ?? "");
}
//funcion para loguear los mensajes de la aplicacion, un metadata opcional
