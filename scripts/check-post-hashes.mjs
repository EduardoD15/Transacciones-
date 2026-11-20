import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logPath = path.join(root, "enviosPosts.txt");
const envPath = path.join(root, ".env.local");
const envPrefix = "TRANSACTION_SECRET=";

function readSecret() {
  if (process.env.TRANSACTION_SECRET) return process.env.TRANSACTION_SECRET;

  const envFile = fs.readFileSync(envPath, "utf8");
  const secretLine = envFile.split(/\r?\n/).find((line) => line.startsWith(envPrefix));
  if (!secretLine) {
    throw new Error("No se encontró TRANSACTION_SECRET en .env.local.");
  }

  const value = secretLine.slice(envPrefix.length).trim();
  return value.replace(/^(['"])(.*)\1$/, "$2");
}

function hmac(payload, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

function hasExpectedFieldTypes(body) {
  return (
    (typeof body.idTxn === "string" || typeof body.idTxn === "number") &&
    typeof body.user === "string" &&
    typeof body.date === "string" &&
    typeof body.value === "number" &&
    Number.isFinite(body.value) &&
    typeof body.paymentMethod === "string"
  );
}

const secret = readSecret();
const log = fs.readFileSync(logPath, "utf8");
const sections = log.split("[Appresso] POST /api/transactions received").slice(1);
const summary = {
  requests: sections.length,
  capturedBodies: 0,
  supportedBodies: 0,
  validHashFormat: 0,
  validHmac: 0,
  invalidHmac: 0,
  httpStatuses: {},
};

for (const section of sections) {
  const status = section.match(/POST \/api\/transactions (\d{3}) in/)?.[1] ?? "unknown";
  summary.httpStatuses[status] = (summary.httpStatuses[status] ?? 0) + 1;

  const bodyMatch = section.match(/body:\s*'(\{"idTxn".*?\})'/s);
  if (!bodyMatch) continue;

  let body;
  try {
    body = JSON.parse(bodyMatch[1]);
  } catch {
    continue;
  }
  summary.capturedBodies += 1;

  if (!hasExpectedFieldTypes(body)) continue;
  summary.supportedBodies += 1;

  if (typeof body.hash !== "string" || !/^[a-f0-9]{64}$/i.test(body.hash)) continue;
  summary.validHashFormat += 1;

  const payload = {
    idTxn: body.idTxn,
    user: body.user,
    date: body.date,
    value: body.value,
    paymentMethod: body.paymentMethod,
  };
  if (hmac(payload, secret) === body.hash.toLowerCase()) {
    summary.validHmac += 1;
  } else {
    summary.invalidHmac += 1;
  }
}

console.log("Comparación local de HMAC; no se enviaron POST ni se modificó la base de datos.");
console.log(JSON.stringify(summary, null, 2));
