# Appresso — monitor de transacciones

Aplicación Next.js para recibir transacciones, validar su HMAC-SHA256 y registrar anomalías de hash, IDs repetidos y ventanas deslizantes. Las transacciones se almacenan en Supabase; los registros anómalos se conservan y el endpoint responde `201`.

## 1. Crear y configurar Supabase

1. Crea un proyecto en [Supabase](https://supabase.com/).
2. En el panel del proyecto, abre **SQL Editor** → **New query**.
3. Copia el contenido completo de `sql/supabase-schema.sql` y ejecuta el script.
4. En **Project Settings** → **API Keys**, copia la URL del proyecto y la clave secreta de servidor (`service_role` en claves heredadas o una `secret` key). No uses `anon` ni `publishable` como clave del servidor.
5. La clave privilegiada solo se usa desde Next.js en el servidor. No la pongas en código del navegador, Postman, GitHub ni en variables con prefijo `NEXT_PUBLIC_`.

El script habilita RLS, concede permisos y crea políticas explícitas para el rol `service_role` en las cuatro tablas de la aplicación. No se habilita acceso directo para `anon` ni `authenticated`.

Si Postman devuelve `new row violates row-level security policy`, ejecuta otra vez el contenido actualizado de `sql/supabase-schema.sql` en **SQL Editor → New query** y comprueba en `.env.local` que `SUPABASE_SERVICE_ROLE_KEY` contiene la clave secreta de servidor, no la clave pública `anon`/`publishable`. No pegues esa clave aquí ni en Postman. Después de cambiar `.env.local`, detén y vuelve a iniciar `npm run dev`.

## 2. Variables de entorno

1. Duplica `.env.example` y llama al archivo `.env.local`.
2. Completa como mínimo:

```dotenv
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU-CLAVE-PRIVILEGIADA
TRANSACTION_SECRET=una-clave-secreta-larga-y-aleatoria
WINDOW_MORNING_TRANSACTIONS=10
WINDOW_AFTERNOON_TRANSACTIONS=6
WINDOW_NIGHT_TRANSACTIONS=3
NEXT_PUBLIC_WINDOW_MORNING_TRANSACTIONS=10
NEXT_PUBLIC_WINDOW_AFTERNOON_TRANSACTIONS=6
NEXT_PUBLIC_WINDOW_NIGHT_TRANSACTIONS=3
```

3. Mantén `.env.local` privado. Reinicia `npm run dev` después de cambiar variables.

La clave de transacciones debe ser la misma en el emisor y en esta aplicación. Si el hash no coincide, la transacción se guarda con `hash_valido=false` y se crea una anomalía `INVALID_HASH`; no se rechaza el pedido.

La fecha `date` siempre representa hora de Colombia (`America/Bogota`). Se aceptan los formatos `2026-09-23T10:30:01.120` (sin zona; se interpreta como hora colombiana) y `2026-09-23T10:30:01.120-05:00` (desfase colombiano explícito). Se rechazan sufijos de otras zonas para evitar ambigüedad. El servidor normaliza ambos formatos al mismo instante UTC al guardar y al validar el HMAC. La ventana se elige según la hora colombiana del evento:

| Hora incluida en `date` | Ventana | Variable |
|---|---:|---|
| 05:00:01–12:00:00 | 10 transacciones | `WINDOW_MORNING_TRANSACTIONS` |
| 12:00:01–20:00:00 | 6 transacciones | `WINDOW_AFTERNOON_TRANSACTIONS` |
| 20:00:01–05:00:00 | 3 transacciones | `WINDOW_NIGHT_TRANSACTIONS` |

Estas variables definen **la cantidad de transacciones consecutivas del mismo usuario** que forman la ventana; no representan segundos. El límite temporal siempre es **3 segundos**: se genera `POTENTIAL_FRAUD` cuando la ventana completa de 10, 6 o 3 transacciones tiene una diferencia de 3 segundos o menos entre la primera y la última. Un grupo incompleto no activa esta anomalía, y un grupo completo que tarde más de 3 segundos tampoco. Se evalúan por separado las transacciones de cada usuario; nunca se mezclan usuarios.

Se comparan tanto las fechas `date` indicadas por el emisor como la hora real de recepción guardada en Supabase. Así, A, B, A se evalúa por usuario A y una fecha manipulada por un cliente no oculta una ráfaga real de POST. La cantidad elegida se guarda en la transacción y en cada anomalía.

`NEXT_PUBLIC_WINDOW_*_TRANSACTIONS` solo refleja esos valores en el dashboard; no cambia la detección. Las antiguas variables terminadas en `_SECONDS` se aceptan como compatibilidad temporal, pero se interpretan como cantidades; renómbralas para evitar confusión. Reinicia `npm run dev` después de editar el archivo de entorno.

## 3. Iniciar el dashboard y la API

Desde la carpeta del proyecto:

```bash
npm install
npm run dev
```

El dashboard queda en `http://localhost:3000`. La aplicación no incluye formulario para crear transacciones: los datos se envían por `POST /api/transactions`.

### Probar desde Postman: tres transacciones con hash válido

En Postman crea una petición **POST** a `http://localhost:3000/api/transactions`. En **Headers** agrega `Content-Type: application/json`. Selecciona **Body → raw → JSON** y pega el cuerpo completo:

```json
{
  "idTxn": "postman-noche-001",
  "user": "prueba-ventana-noche@example.com",
  "date": "2026-10-12T21:00:01.000-05:00",
  "value": 25000,
  "paymentMethod": "Tarjeta",
  "hash": "{{hash}}"
}
```

En el Environment activo de Postman configura `TRANSACTION_SECRET` con el mismo valor que en `.env.local`; no pongas la clave de Supabase en Postman. En **Scripts → Pre-request** pega el script del proyecto sin modificarlo:

```javascript
const body = JSON.parse(pm.request.body.raw);

const transaction = {
  idTxn: String(body.idTxn).trim(),
  user: String(body.user).trim().toLowerCase(),
  date: new Date(body.date).toISOString(),
  value: Number(body.value),
  paymentMethod: String(body.paymentMethod).trim()
};

const secret = pm.environment.get("TRANSACTION_SECRET");
if (!secret) {
  throw new Error("Agrega TRANSACTION_SECRET al Environment de Postman.");
}

const hash = CryptoJS.HmacSHA256(
  JSON.stringify(transaction),
  secret
).toString(CryptoJS.enc.Hex);

pm.variables.set("hash", hash);
console.log("Hash HMAC generado:", hash);
```

Pulsa **Send** tres veces, cambiando solo el `idTxn` y `date` en el body; conserva el mismo usuario:

| Envío | `idTxn` | `date` |
|---|---|---|
| 1 | `postman-noche-001` | `2026-10-12T21:00:01.000-05:00` |
| 2 | `postman-noche-002` | `2026-10-12T21:00:02.000-05:00` |
| 3 | `postman-noche-003` | `2026-10-12T21:00:03.000-05:00` |

Para cada envío, copia los valores de esa fila en `idTxn` y `date` del body y pulsa **Send**. El script genera el hash válido automáticamente usando el body actual. En la tercera respuesta espera `hashValid: true` y una anomalía `POTENTIAL_FRAUD`: son las 3 transacciones de ese usuario en una ventana de noche que abarca 2 segundos. No envíes usuarios distintos para esta prueba. Para repetirla, usa un usuario y IDs nuevos porque las transacciones ya enviadas quedan guardadas.

#### Enviar varias transacciones en un solo POST

La ruta también acepta un arreglo JSON y registra sus elementos secuencialmente. Para enviar un arreglo, reemplaza el Pre-request Script individual por este script de lote. Calcula un HMAC por transacción antes de enviar el arreglo completo:

```javascript
const transactions = JSON.parse(pm.request.body.raw);
if (!Array.isArray(transactions) || transactions.length === 0) {
  throw new Error("El body debe ser un arreglo JSON con al menos una transacción.");
}

const secret = pm.environment.get("TRANSACTION_SECRET");
if (!secret) {
  throw new Error("Agrega TRANSACTION_SECRET al Environment de Postman.");
}

const transactionsWithHashes = transactions.map((body, index) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`El elemento ${index + 1} debe ser un objeto de transacción.`);
  }

  const rawDate = String(body.date).trim();
  const dateWithZone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(rawDate)
    ? rawDate
    : `${rawDate}-05:00`;
  const parsedDate = new Date(dateWithZone);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(`La fecha del elemento ${index + 1} no es válida.`);
  }

  const transaction = {
    idTxn: String(body.idTxn).trim(),
    user: String(body.user).trim().toLowerCase(),
    date: parsedDate.toISOString(),
    value: Number(body.value),
    paymentMethod: String(body.paymentMethod).trim()
  };
  const hash = CryptoJS.HmacSHA256(
    JSON.stringify(transaction),
    secret
  ).toString(CryptoJS.enc.Hex);

  return { ...body, hash };
});

const headers = { "Content-Type": "application/json" };
pm.request.headers.each((header) => {
  if (!header.disabled && header.key.toLowerCase() !== "content-type") {
    headers[header.key] = pm.variables.replaceIn(header.value);
  }
});

const url = pm.variables.replaceIn(pm.request.url.toString());
pm.execution.skipRequest();
pm.sendRequest(
  {
    url,
    method: "POST",
    header: headers,
    body: {
      mode: "raw",
      raw: JSON.stringify(transactionsWithHashes)
    }
  },
  (error, response) => {
    if (error) {
      console.error("Falló el POST batch:", error);
      return;
    }
    console.log(`Respuesta batch — HTTP ${response.code}:`, response.text());
  }
);
```

En **Body → raw → JSON**, pega un arreglo; puedes omitir `hash` o dejar `"hash": "{{hash}}"`, pues el script lo reemplaza por un HMAC propio para cada elemento. Pulsa **Send una sola vez**: el script omite el envío automático de Postman y realiza el POST batch con los hashes calculados. Consulta el resultado en **View → Show Postman Console**; una respuesta exitosa contiene `total` y un `results` por cada transacción. Verifica que cada `results[n].hashValid` sea `true`. Los elementos se procesan en orden; si ocurre un error de servidor a mitad del lote, la respuesta indica `failedIndex` y `processedCount`, pues los resultados anteriores ya podrían haberse guardado.

Si un resultado tiene `hashValid: false` y una anomalía `INVALID_HASH` con `count: 1`, el problema es el HMAC de ese elemento; no es el detector de ventana. Revisa que `TRANSACTION_SECRET` de Postman y del servidor coincidan. Una alerta `POTENTIAL_FRAUD` debe mostrar en `count` el tamaño de la ventana evaluada y sus transacciones vinculadas en `results[n].anomalies`.

Para probar las demás franjas, usa el mismo body y script, un correo nuevo y el número de envíos que corresponda:

| Franja | Hora del `date` | Cantidad de POST |
|---|---|---:|
| Mañana | Desde `2026-10-12T10:00:01.000-05:00`, aumenta 200 ms por envío | 10 |
| Tarde-noche | Desde `2026-10-12T15:00:01.000-05:00`, aumenta 400 ms por envío | 6 |
| Noche-madrugada | Desde `2026-10-12T21:00:01.000-05:00`, aumenta 500 ms por envío | 3 |

En cada caso, cambia el ID para que sea único, conserva el mismo usuario y suma el intervalo indicado al timestamp completo de la fecha base en cada body. El hash se recalcula solo, sin alterar el script.

La aplicación **no guarda las peticiones solo en la memoria volátil del proceso**. Cada POST se persiste en Supabase y se compara con grupos deslizantes del mismo usuario, por fecha `date` y por hora de recepción. La alerta requiere que la ventana completa de N transacciones abarque 3 segundos o menos. No se mezclan usuarios ni se carga el historial completo en RAM; los índices por usuario y fecha aceleran las consultas. Ejecuta el SQL actualizado para añadir `ventana_transacciones` a las tablas existentes.

### Respuesta del POST

Una recepción válida del formato responde `201`, aunque se detecten anomalías:

```json
{
  "message": "Transacción registrada y evaluada; las anomalías no bloquean el registro.",
  "transaction": {},
  "hashValid": true,
  "duplicateId": false,
  "anomalies": []
}
```

Solo los errores de transporte/formato (por ejemplo, JSON mal formado o campos requeridos ausentes) responden con error HTTP. Un hash incorrecto o ID repetido se persiste y se informa en `anomalies`.

## 4. Endpoints

- `POST /api/transactions`: guarda la transacción, valida el HMAC, busca ID duplicado y evalúa la ventana temporal.
- `GET /api/transactions`: lista las transacciones guardadas.
- `GET /api/anomalies`: lista las anomalías y las transacciones asociadas a cada una.
- `PATCH /api/anomalies`: actualiza el estado de una anomalía existente. Envía JSON con `id` y `status`, donde `status` puede ser `abierta`, `revisada` o `descartada`. El dashboard permite cambiarlo desde el selector de estado de cada anomalía.

La anomalía de ventana incluye las transacciones de la ventana y el ID de la transacción disparadora. El ID repetido se compara globalmente y no es una restricción única en la base de datos, por lo que se pueden guardar todos los intentos.

La ruta PATCH, al igual que las demás rutas actuales, no requiere sesión ni token. No la expongas públicamente sin añadir autenticación y autorización si solo personal autorizado debe cambiar los estados.

## 5. Filtro global y métricas

El filtro global permite **un día**, **rango de días** (incluye ambas fechas), **una semana** (de lunes a domingo según la fecha elegida), **un mes**, **un año** o **General**. Usa los selectores de calendario para días/semanas/meses y escribe el año cuando elijas año. Este filtro aplica al dashboard completo: indicadores, tendencias, gráficos y ambas tablas. Los filtros compartidos debajo de los gráficos limitan los resultados de ambas tablas y nunca amplían el período global seleccionado. El filtro de tipo (`DUPLICATE_ID`, `POTENTIAL_FRAUD` o `INVALID_HASH`) filtra la tabla Anomalías; la tabla Transacciones solo muestra registros sin ninguna anomalía y conserva los demás filtros compartidos. Los indicadores no cambian al refinar los filtros de tabla. Las tarjetas Hoy / Esta semana / Este mes / Este año / General son un resumen de referencia y no cambian la selección global.

El dashboard presenta totales por período, transacciones implicadas en anomalías, tasa sospechosa, usuarios afectados y recurrentes, total monetario sospechoso, promedio por usuario, nuevas/abiertas/revisadas/descartadas, casos recurrentes, anomalías por nivel, métodos de pago, distribución de anomalías por hora y evolución diaria con picos. Al expandir una anomalía, el detalle se abre en una fila secundaria debajo de la fila correspondiente, ocupa todo el ancho de la tabla y queda visualmente vinculado a ella; muestra las transacciones ordenadas cronológicamente, la duración observada, la ventana aplicada y el registro disparador resaltado. En «Tipo / nivel» se listan los distintos tipos y niveles relacionados con las transacciones involucradas. Las dos tablas usan paginación independiente de 5 filas por página; los filtros y el período global limitan los resultados paginados. El botón «Limpiar filtros y período» limpia los filtros de las tablas y restablece el período global a General.

Los tipos de anomalía (`POTENTIAL_FRAUD`, `DUPLICATE_ID` e `INVALID_HASH`) se muestran en la tabla **Anomalías** y sus transacciones quedan disponibles en el detalle desplegable. La tabla **Transacciones** solo presenta registros cuyo estado es `NORMAL` y que no están relacionados con ninguna anomalía; por ello no muestra ni el registro que dispara un duplicado ni otros registros relacionados con fraude potencial o hash inválido. El resultado de validación del hash se muestra por separado en las transacciones normales.

## 6. Acceso público de la API

`POST /api/transactions` no exige sesión ni token: cualquier cliente que tenga la URL del servidor puede llamarlo. Los casos de negocio (hash inválido, ID repetido, ventana sospechosa) se guardan como anomalías y no bloquean el POST. La API conserva validación de JSON/campos requeridos y reportará errores reales de conexión o base de datos.

La API escribe en Supabase con la clave secreta de servidor (`SUPABASE_SERVICE_ROLE_KEY`) y RLS activado. El esquema crea políticas explícitas para que `service_role` lea y modifique `usuarios`, `transacciones`, `anomalias` y `anomalia_transacciones`; revoca acceso de tabla y secuencias a `anon` y `authenticated`. **No concedas permisos de escritura a roles públicos.** Postman llama a Next.js, no directamente a Supabase; abrir las tablas permitiría saltarse la validación de hashes e IDs. Si continúa el error de RLS después de ejecutar el SQL, revisa que la aplicación realmente esté usando la clave secreta de servidor y reinicia el proceso. El endpoint sin autenticación puede ser abusado por cualquiera que obtenga la URL; no lo publiques con ngrok hasta decidir cómo limitar abuso.

## 7. Carpetas principales

- `src/app/api/`: rutas HTTP del backend.
- `src/components/dashboard.tsx`: dashboard, período global, filtros compartidos entre tablas y detalle desplegable.
- `src/lib/security.ts`: creación y comparación constante del HMAC.
- `src/lib/transaction-service.ts`: lógica de negocio y persistencia Supabase.
- `src/lib/sliding-window.ts`: módulo de detección offline reutilizable.
- `src/lib/window-rules.ts`: ventanas configurables por hora recibida.
- `sql/supabase-schema.sql`: tablas, relaciones e índices.
