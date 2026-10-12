export function logger(message: string, metadata?: unknown) {
  console.info(`[Appresso] ${message}`, metadata ?? "");
}
