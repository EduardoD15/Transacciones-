import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logPath = path.join(root, "enviosPosts.txt");
const args = process.argv.slice(2);
const shouldSend = args.includes("--send");
const endpointArg = args.find((arg) => arg.startsWith("--url="));
const endpoint = endpointArg?.slice("--url=".length)
  ?? process.env.POST_REPLAY_URL
  ?? "http://localhost:3000/api/transactions";

function decodeInspectedString(value) {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      decoded += character;
      continue;
    }

    const escaped = value[++index];
    const simpleEscapes = {
      "\\": "\\",
      "'": "'",
      "\"": "\"",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    };
    if (Object.hasOwn(simpleEscapes, escaped)) {
      decoded += simpleEscapes[escaped];
    } else if (escaped === "x" && /^[\da-f]{2}$/i.test(value.slice(index + 1, index + 3))) {
      decoded += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 3), 16));
      index += 2;
    } else if (escaped === "u" && /^[\da-f]{4}$/i.test(value.slice(index + 1, index + 5))) {
      decoded += String.fromCharCode(Number.parseInt(value.slice(index + 1, index + 5), 16));
      index += 4;
    } else if (escaped !== undefined) {
      decoded += escaped;
    }
  }
  return decoded;
}

function getCapturedBodies(log) {
  const sections = log.split("[Appresso] POST /api/transactions received").slice(1);
  const bodies = [];
  let skipped = 0;

  for (const section of sections) {
    const bodyMatch = section.match(/body:\s*'((?:\\.|[^'\\])*)'/s);
    if (!bodyMatch || /truncated:\s*true/.test(section)) {
      skipped += 1;
      continue;
    }
    bodies.push(decodeInspectedString(bodyMatch[1]));
  }

  return { bodies, requestCount: sections.length, skipped };
}

function responseSummary(payload) {
  if (!payload || typeof payload !== "object") return "";
  const fields = [];
  if (typeof payload.hashValid === "boolean") {
    fields.push(`hashValid=${payload.hashValid}`);
  }
  if (typeof payload.processed === "boolean") {
    fields.push(`processed=${payload.processed}`);
  }
  if (typeof payload.failedIndex === "number") {
    fields.push(`failedIndex=${payload.failedIndex}`);
  }
  if (typeof payload.error === "string") {
    fields.push(`error=${payload.error}`);
  }
  if (Array.isArray(payload.details)) {
    const details = payload.details
      .map((item) => item && typeof item === "object"
        ? `${item.path ?? "body"}: ${item.message ?? "invalid"}`
        : "")
      .filter(Boolean);
    if (details.length > 0) fields.push(`details=${details.join("; ")}`);
  }
  return fields.length > 0 ? ` | ${fields.join(" | ")}` : "";
}

if (args.includes("--help")) {
  console.log("Uso: node scripts/replay-posts.mjs [--send] [--url=http://localhost:3000/api/transactions]");
  console.log("Sin --send solo cuenta los cuerpos; con --send los reenvía secuencialmente.");
  process.exit(0);
}

const url = new URL(endpoint);
if (!["http:", "https:"].includes(url.protocol)) {
  throw new Error("La URL de replay debe usar HTTP o HTTPS.");
}

const { bodies, requestCount, skipped } = getCapturedBodies(
  fs.readFileSync(logPath, "utf8"),
);
console.log(`Peticiones encontradas: ${requestCount}`);
console.log(`Cuerpos completos para replay: ${bodies.length}; omitidos: ${skipped}`);
console.log(`Destino: ${url.origin}${url.pathname}`);

if (!shouldSend) {
  console.log("Modo simulación: no se enviaron peticiones. Agrega --send para ejecutarlas.");
  process.exit(0);
}

const statusCounts = {};
let hashValidCount = 0;
let hashInvalidCount = 0;
let requestFailures = 0;

for (let index = 0; index < bodies.length; index += 1) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodies[index],
    });
    const responseText = await response.text();
    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = null;
    }

    statusCounts[response.status] = (statusCounts[response.status] ?? 0) + 1;
    if (payload?.hashValid === true) hashValidCount += 1;
    if (payload?.hashValid === false) hashInvalidCount += 1;
    console.log(
      `${index + 1}/${bodies.length}: HTTP ${response.status}${responseSummary(payload)}`,
    );
  } catch (error) {
    requestFailures += 1;
    console.log(
      `${index + 1}/${bodies.length}: no se pudo completar (${error instanceof Error ? error.message : "error desconocido"})`,
    );
  }
}

console.log("Resumen:", JSON.stringify({
  sent: bodies.length,
  requestFailures,
  statusCounts,
  hashValid: hashValidCount,
  hashInvalid: hashInvalidCount,
}, null, 2));
