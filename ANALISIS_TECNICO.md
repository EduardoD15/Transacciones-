# Análisis técnico: validaciones, anomalías y seguridad

Este documento responde dónde están implementados los controles y qué hace cada uno. Las rutas completas corresponden a este equipo y repositorio:
`C:\Users\eduar\Desktop\Transacciones-`.

## 1. Validaciones: dónde están y por qué hay varias

Hay validaciones en capas distintas porque cada una protege una frontera diferente:

1. **Formato de la solicitud HTTP** — `C:\Users\eduar\Desktop\Transacciones-\src\app\api\transactions\route.ts`
   - `transactionSchema` valida los campos: `idTxn` acepta texto o número y no puede quedar vacío; `user` es texto no vacío; `date` debe cumplir el formato de fecha y hora colombiano; `value` debe ser un número finito; `paymentMethod` es texto. `hash` es opcional, e `ip` es opcional o nula.
   - También acepta un lote JSON no vacío. Si JSON está mal formado o el esquema falla, responde `400`.
   - No exige que `user` sea un correo válido ni que `value` sea positivo; `paymentMethod` tampoco se limita a una lista fija. Son límites de la validación actual.

2. **Fecha y normalización** — `C:\Users\eduar\Desktop\Transacciones-\src\lib\colombia-date.ts`
   - Comprueba la forma de fecha colombiana aceptada y su validez, interpreta fechas sin zona como hora de Colombia y normaliza al instante UTC.
   - La normalización evita que formatos equivalentes produzcan hashes distintos.

3. **Regla de ventana configurable** — `C:\Users\eduar\Desktop\Transacciones-\src\lib\window-rules.ts`
   - Lee las variables `WINDOW_MORNING_TRANSACTIONS`, `WINDOW_AFTERNOON_TRANSACTIONS` y `WINDOW_NIGHT_TRANSACTIONS` y exige enteros positivos.
   - Selecciona la cantidad de transacciones según la hora colombiana de `date`. Los valores predeterminados son 10, 6 y 3, respectivamente. Los nombres antiguos con sufijo `_SECONDS` se aceptan como compatibilidad, aunque ahora se interpretan como cantidades.

4. **Hash y configuración de servidor** — `C:\Users\eduar\Desktop\Transacciones-\src\lib\security.ts` y `C:\Users\eduar\Desktop\Transacciones-\src\lib\supabase.ts`
   - El hash debe tener 64 caracteres hexadecimales y debe corresponder al HMAC esperado.
   - La aplicación exige `TRANSACTION_SECRET` y las credenciales de servidor de Supabase. Si faltan, se genera un error de configuración en vez de continuar como si todo estuviera bien.

5. **Restricciones de base de datos** — `C:\Users\eduar\Desktop\Transacciones-\sql\supabase-schema.sql`
   - Define campos obligatorios, relaciones, tipos numéricos e índices. El esquema conserva IDs de transacción repetidos intencionalmente para poder registrarlos y generar una anomalía en lugar de rechazarlos mediante una restricción `UNIQUE`.

**Distinción importante:** un error de formato detiene la solicitud con `400`; en cambio, un hash incorrecto o un ID repetido se consideran anomalías de negocio: la transacción se guarda y la API informa el hallazgo.

## 2. Logs y diagnóstico

- El logger está en `C:\Users\eduar\Desktop\Transacciones-\src\lib\logger.ts`; actualmente escribe con `console.info` y agrega el prefijo `[Appresso]`.
- `C:\Users\eduar\Desktop\Transacciones-\src\app\api\transactions\route.ts` registra errores de la API, el procesamiento de transacciones individuales y de lotes, y algunos datos de resultado como el ID guardado, validez del hash, duplicado y cantidad de anomalías.
- `C:\Users\eduar\Desktop\Transacciones-\src\app\api\anomalies\route.ts` registra errores al consultar anomalías.
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\transaction-service.ts` propaga errores de Supabase con contexto en el mensaje; las rutas los convierten en respuesta HTTP.

**No está implementado en el código revisado:** almacenamiento persistente de logs, niveles de log configurables, IDs de correlación, un endpoint de salud/diagnóstico, ni integración explícita con una plataforma de monitoreo. Los errores de JSON o de esquema se responden al cliente, pero no se registran mediante el logger.

## 3. Cómo se genera y se compara el hash

Implementación: `C:\Users\eduar\Desktop\Transacciones-\src\lib\security.ts`.

1. `buildTransactionHash` construye un objeto con estos campos normalizados: `idTxn` (texto recortado), `user` (recortado y en minúsculas), `date` (normalizada a ISO UTC), `value` (número) y `paymentMethod` (recortado).
2. Serializa ese objeto con `JSON.stringify` y calcula un **HMAC-SHA-256** con `TRANSACTION_SECRET`.
3. Devuelve el resultado en hexadecimal.
4. `verifyTransactionHash` comprueba que el hash recibido sea hexadecimal de 64 caracteres, vuelve a calcular el valor esperado y compara los bytes con `crypto.timingSafeEqual`.
5. La verificación se ejecuta en `C:\Users\eduar\Desktop\Transacciones-\src\lib\transaction-service.ts`, antes de persistir la transacción. El resultado se guarda en `hash_valido`; un hash incorrecto crea una anomalía `INVALID_HASH` de nivel alto.

La aplicación **no genera automáticamente la clave secreta**: debe configurarse como `TRANSACTION_SECRET`, compartida con el emisor. El ejemplo de variables está en `C:\Users\eduar\Desktop\Transacciones-\.env.example`. No se debe poner una clave real en variables `NEXT_PUBLIC_*`.

## 4. Cómo se detectan las anomalías

El flujo activo de la API está en `C:\Users\eduar\Desktop\Transacciones-\src\lib\transaction-service.ts`:

- **`INVALID_HASH`**: el HMAC recibido no coincide. Se registra con nivel `HIGH`; no se rechaza la transacción.
- **`DUPLICATE_ID`**: busca transacciones previas con el mismo `idTxn` y, si las encuentra, registra una anomalía de nivel `HIGH`. La búsqueda no se restringe por usuario. El esquema no impone unicidad para que se puedan conservar todos los intentos.
- **`POTENTIAL_FRAUD`**: comprueba ventanas de la misma persona por fecha declarada (`date`) y por hora real de recepción. Cada consulta cubre un intervalo de hasta tres segundos a cada lado del registro actual; después el código ordena y busca una ventana completa que incluya la transacción recibida. La ventana elegida debe abarcar como máximo tres segundos.

El tipo de anomalía y sus registros se almacenan en `anomalias` y `anomalia_transacciones`, definidas en `C:\Users\eduar\Desktop\Transacciones-\sql\supabase-schema.sql`. La regla temporal constante está en `C:\Users\eduar\Desktop\Transacciones-\src\lib\anomaly-rules.ts`.

El nivel de la anomalía de ventana en el flujo activo se asigna como `HIGH` si la ventana encontrada tiene cuatro o más elementos; si no, `MEDIUM`. La cantidad objetivo procede de la regla por franja horaria.

### Cambiar el estado de una anomalía

Los estados disponibles son **abierta**, **revisada** y **descartada**. Las anomalías nuevas se crean como abiertas; desde el selector de cada fila en el dashboard se puede cambiar el estado y el cambio se persiste en Supabase.

- `C:\Users\eduar\Desktop\Transacciones-\src\app\api\anomalies\route.ts` implementa `PATCH` y valida el ID y que el estado pertenezca a los tres permitidos.
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\transaction-service.ts` guarda la actualización en la base de datos.
- `C:\Users\eduar\Desktop\Transacciones-\src\components\dashboard.tsx` muestra el selector, informa mientras guarda y muestra errores si no se pudo actualizar. Los conteos de abiertas, revisadas y descartadas reflejan el estado actualizado.

**Importante:** la API actual no requiere sesión ni token, por lo que este `PATCH` tampoco está autenticado. Si la aplicación se publica y solo personal autorizado debe cambiar los estados, hay que añadir autenticación y autorización antes de exponerla públicamente.

### Módulo de ventana deslizante independiente

`C:\Users\eduar\Desktop\Transacciones-\src\lib\sliding-window.ts` también contiene `detectSlidingWindowAnomalies`: agrupa un arreglo de transacciones por usuario, ordena por fecha y mantiene una ventana deslizante. **La ruta de registro actual no llama a esta función**; implementa su búsqueda de ventana en `transaction-service.ts` usando datos consultados a Supabase. El módulo independiente recibe todas sus transacciones en memoria y, por defecto, usa una ventana de tres transacciones.

## 5. Uso de memoria

- La base persistente es Supabase; las transacciones no dependen únicamente de la memoria volátil del proceso.
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\transaction-service.ts` limita las consultas de listado a 2.000 transacciones y 2.000 anomalías. Para detectar una ráfaga consulta solo el usuario y el rango temporal cercano; no descarga todo el historial para cada POST.
- El dashboard (`C:\Users\eduar\Desktop\Transacciones-\src\components\dashboard.tsx`) mantiene en estado React los arreglos recibidos de transacciones y anomalías y calcula filtros/métricas en el cliente.
- El módulo independiente `sliding-window.ts` trabaja sobre el arreglo completo que recibe.

**No está implementado:** un límite explícito de bytes del cuerpo HTTP, un máximo de elementos por lote, una cuota de memoria, medición/registro de consumo de memoria o un caché de aplicación. El POST de lote procesa los elementos secuencialmente, pero primero parsea el cuerpo completo. Las consultas de ventana no especifican un límite de filas; en escenarios de volumen extremo, la cantidad devuelta para un usuario dentro del intervalo puede consumir memoria adicional.

## 6. Ventana deslizante

- La cantidad de elementos se elige con la hora colombiana de la transacción: mañana, tarde-noche o noche-madrugada. Configuración y valores predeterminados: `C:\Users\eduar\Desktop\Transacciones-\src\lib\window-rules.ts` y `C:\Users\eduar\Desktop\Transacciones-\.env.example`.
- El lapso temporal máximo es siempre **3 segundos**, definido en `C:\Users\eduar\Desktop\Transacciones-\src\lib\anomaly-rules.ts`.
- Se requieren N transacciones del mismo usuario dentro de ese lapso; no se mezclan usuarios. El flujo activo contrasta tanto la fecha indicada por el emisor como la hora de recepción persistida.
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\transaction-service.ts` busca ventanas que incluyan el registro actual y escoge la de menor duración para cada fuente temporal; si la ventana por recepción tiene más transacciones que la de fecha, usa la de recepción.
- `NEXT_PUBLIC_WINDOW_*_TRANSACTIONS` solo permite mostrar la configuración en el dashboard; no controla el detector.

## 7. Métodos HTTP

Las rutas activas están bajo `C:\Users\eduar\Desktop\Transacciones-\src\app\api\`:

| Ruta | Método implementado | Función |
|---|---|---|
| `/api/transactions` | `GET` | Lista hasta 2.000 transacciones. |
| `/api/transactions` | `POST` | Recibe una transacción o un lote, valida el formato, verifica el hash, persiste y evalúa anomalías. |
| `/api/anomalies` | `GET` | Lista hasta 2.000 anomalías y sus transacciones relacionadas. |
| `/api/anomalies` | `PATCH` | Cambia el estado a `abierta`, `revisada` o `descartada`; el dashboard proporciona el selector. |

**No están implementados** `PUT` ni `DELETE` en estas rutas. Según la documentación del proyecto, las rutas no requieren sesión ni token; son públicas si el servidor es accesible. Ver `C:\Users\eduar\Desktop\Transacciones-\README.md`.

## 8. Integridad y criptografía

- **Integridad del mensaje recibido:** HMAC-SHA-256 permite verificar que los cinco campos incluidos en el payload coincidan con el emisor que conoce el secreto. La comparación del digest es de tiempo constante. Código: `C:\Users\eduar\Desktop\Transacciones-\src\lib\security.ts`.
- **Integridad registrada:** la aplicación persiste el hash recibido y el resultado booleano `hash_valido` en Supabase; el esquema está en `C:\Users\eduar\Desktop\Transacciones-\sql\supabase-schema.sql`.
- **Control de acceso a datos:** el esquema habilita RLS, concede permisos al rol `service_role` y revoca acceso de tabla/secuencias a `anon` y `authenticated`. El cliente privilegiado se crea en servidor en `C:\Users\eduar\Desktop\Transacciones-\src\lib\supabase.ts`.
- **No es cifrado:** HMAC no oculta ni cifra los datos; solo permite autenticar/integrar los campos firmados.

**No está implementado en el código revisado:** cifrado propio de los datos, firma independiente de cada fila al leerla, encadenamiento de hashes, un registro inmutable de auditoría o configuración explícita de TLS/cifrado en tránsito o en reposo. Por tanto, el HMAC valida el payload presentado en el POST, pero no prueba por sí solo que una fila no haya sido alterada posteriormente directamente en la base de datos. El cifrado y transporte seguro deben verificarse/configurarse en la plataforma de despliegue y en Supabase.

## Rutas principales consultadas

- `C:\Users\eduar\Desktop\Transacciones-\src\app\api\transactions\route.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\app\api\anomalies\route.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\transaction-service.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\security.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\sliding-window.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\window-rules.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\anomaly-rules.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\colombia-date.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\logger.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\lib\supabase.ts`
- `C:\Users\eduar\Desktop\Transacciones-\src\components\dashboard.tsx`
- `C:\Users\eduar\Desktop\Transacciones-\sql\supabase-schema.sql`
- `C:\Users\eduar\Desktop\Transacciones-\.env.example`
- `C:\Users\eduar\Desktop\Transacciones-\README.md`
