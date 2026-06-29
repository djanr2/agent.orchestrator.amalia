# PLAN 02 — Etapa 2: Orchestrator API (Capa 1)

> Lee primero [`PLAN-00-INDICE.md`](PLAN-00-INDICE.md) y termina la Etapa 1.
> Haz las tareas en orden; no avances con tests rojos.

## Objetivo

Construir el **único proceso con acceso de escritura a `amalia.db`**: una API REST + WebSocket
(Express + socket.io) que gestiona bees, tareas, resultados, integraciones y eventos, con
autenticación por token y jobs de mantenimiento.

## Prerrequisitos

- Etapa 1 completa (`src/db/index.ts`, `schema.sql`, tipos).

## Decisiones ya tomadas (no las cambies)

- La **identidad** de quien llama se deriva SIEMPRE del token (`Authorization: Bearer <token>`),
  nunca del body. Lo mismo en el handshake de WebSocket.
- El **token de operador** (rol `amalia`) puede hacer todo; un **token de bee** solo puede
  operar sobre sí mismo.
- Las transiciones de estado de tareas y la inserción de eventos van **en la misma transacción**.
- Cada mutación relevante inserta una fila en `events` y la emite por WebSocket.
- Puerto por defecto: **4000** (configurable por variable `AMALIA_PORT`).

---

## Tarea 2.1 — Autenticación (tokens)

**Acción:** crea `src/api/auth.ts`:

```ts
import { randomBytes, createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export function generateToken(): string {
  return randomBytes(32).toString("hex"); // 64 chars
}
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface AuthIdentity { beeId: number; name: string; isOperator: boolean; }

/** Devuelve la identidad si el token corresponde a un bee registrado; null si no. */
export function identifyByToken(db: DatabaseSync, token: string): AuthIdentity | null {
  if (!token) return null;
  const row = db.prepare("SELECT id, name FROM bees WHERE token_hash = ?").get(hashToken(token)) as
    | { id: number; name: string } | undefined;
  if (!row) return null;
  return { beeId: row.id, name: row.name, isOperator: row.name === "amalia" };
}
```

**Acción:** crea `src/api/auth.test.ts`:

```ts
import { test, expect } from "vitest";
import { generateToken, hashToken } from "./auth.js";
test("genera token de 64 hex y su hash es estable", () => {
  const t = generateToken();
  expect(t).toMatch(/^[0-9a-f]{64}$/);
  expect(hashToken(t)).toBe(hashToken(t));
  expect(hashToken(t)).not.toBe(t);
});
```

**Verificación:** `npm test` pasa.

---

## Tarea 2.2 — Validación de entrada (zod) y reglas de nombres

**Acción:** crea `src/api/validation.ts`. Define los esquemas y los validadores de seguridad.

```ts
import { z } from "zod";

export const BEE_NAME_RE = /^[a-z][a-z0-9-]*-bee$/;   // p.ej. database-bee
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;        // sin / \ ..
export const COMMIT_RE = /^[0-9a-f]{7,40}$/;

export const registerBeeSchema = z.object({
  worktree_path: z.string().min(1),
  engine: z.enum(["claude-code","opencode","copilot-cli","codex-cli","ollama","custom"]),
  connection_mode: z.enum(["cli","api"]),
  model: z.string().optional(),
  role_summary: z.string().optional(),
  heartbeat_seconds: z.number().int().positive().default(60),
});

export const createTaskSchema = z.object({
  assigned_to: z.string().min(1),                      // nombre del bee destino
  description: z.string().min(1),
  acceptance_criteria: z.string().optional(),
  priority: z.enum(["high","medium","low"]).default("medium"),
  slug: z.string().regex(SLUG_RE),
  depends_on: z.array(z.string()).default([]),         // códigos TASK-XXX
  max_attempts: z.number().int().positive().default(3),
  max_run_seconds: z.number().int().positive().optional(),
});

export const claimSchema = z.object({ instance_id: z.string().min(1) });

export const resultSchema = z.object({
  outcome: z.enum(["completed","failed"]),
  idempotency_key: z.string().min(1),
  files_changed: z.array(z.string()).optional(),
  decisions: z.string().optional(),
  blockers: z.string().optional(),
  notes: z.string().optional(),
});
```

**Verificación:** `npx tsc --noEmit` pasa.

---

## Tarea 2.3 — Eventos y WebSocket

**Acción:** crea `src/api/events.ts`. Una sola función inserta en `events` y emite por socket.

```ts
import type { DatabaseSync } from "node:sqlite";
import type { Server as IoServer } from "socket.io";

export type EventType =
  | "task:created" | "task:status_changed" | "bee:registered" | "bee:heartbeat"
  | "bee:offline" | "integration:success" | "integration:conflict"
  | "reconcile:conflict" | "update:conflict";

/** Inserta el evento y lo emite. Devuelve el id de la fila en events. DEBE llamarse dentro
 *  de la misma transacción que la mutación que lo origina (pásale el db de la tx). */
export function emitEvent(
  db: DatabaseSync, io: IoServer | null, type: EventType, payload: unknown
): number {
  const info = db.prepare("INSERT INTO events (type, payload) VALUES (?, ?)")
    .run(type, JSON.stringify(payload));
  const id = Number(info.lastInsertRowid);
  if (io) io.emit(type, { id, type, payload });   // emisión fuera de la tx es aceptable aquí
  return id;
}
```

> Regla: la inserción en `events` va dentro de la transacción de la mutación; la emisión por
> socket (`io.emit`) puede ocurrir justo después de confirmar la transacción. Si dudas, emite
> después del `commit`.

**Verificación:** `npx tsc --noEmit` pasa.

---

## Tarea 2.4 — Servicio de bees

**Acción:** crea `src/api/bees.service.ts` con funciones puras sobre la DB:

- `registerOrUpdateBee(db, identity, input): Bee` — actualiza la fila del bee (ya pre-creada por `hatch`/`init`; ver Etapa 3). Solo puede tocar su propia fila.
- `heartbeat(db, beeId): void` — fija `last_heartbeat_at = datetime('now')` y `status='idle'` si estaba `offline`.
- `listBees(db): Bee[]`.

Firmas y SQL clave:

```ts
export function heartbeat(db, beeId: number): void {
  db.prepare(`UPDATE bees
              SET last_heartbeat_at = datetime('now'),
                  status = CASE WHEN status='offline' THEN 'idle' ELSE status END
              WHERE id = ?`).run(beeId);
}
```

**Verificación:** test en la Tarea 2.9 (integración).

---

## Tarea 2.5 — Servicio de tareas: crear, listar, dependencias, ciclos

**Acción:** crea `src/api/tasks.service.ts`.

`createTask(db, io, creatorId, input)`:
1. Resolver `assigned_to` (nombre) → `bee.id`. Si no existe, error `BEE_NOT_FOUND`.
2. Generar `code` único: `TASK-` + número incremental (usa `MAX(id)+1` o un contador).
3. Garantizar `slug` único por `(assigned_to, slug)`: si ya existe, sufija con el code en minúsculas (`<slug>-task-014`).
4. Resolver `depends_on` (códigos) → ids. **Validar que no se forme un ciclo** (ver función `wouldCreateCycle`).
5. Estado inicial: `blocked` con `block_reason='deps_unresolved'` si tiene dependencias no `completed`; si no, `pending`.
6. Insertar `tasks` + filas en `task_dependencies` + evento `task:created`, todo en una transacción.

`wouldCreateCycle(db, taskId, dependsOnId): boolean` — recorrido del grafo (DFS) sobre
`task_dependencies` partiendo de `dependsOnId`; si alcanza `taskId`, hay ciclo.

`listTasks(db, filters)` — filtros opcionales por `status` (lista) y `assigned_to` (nombre).

**Acción (test):** crea `src/api/tasks.service.test.ts` que cubra:
- crear tarea sin dependencias → queda `pending`.
- crear tarea con dependencia no completada → queda `blocked` (`deps_unresolved`).
- intentar crear una dependencia cíclica → lanza error.
- dos tareas con mismo slug para el mismo bee → la segunda recibe slug sufijado.

**Verificación:** `npm test` pasa esos 4 casos.

---

## Tarea 2.6 — Reclamo atómico de tarea (claim)

**Acción:** en `src/api/tasks.service.ts`, agrega `claimTask(db, io, beeId, taskCode, instanceId, heartbeatSeconds)`:

Ejecuta el UPDATE atómico EXACTO (de la especificación) dentro de `BEGIN IMMEDIATE`:

```sql
UPDATE tasks
SET status='in_progress',
    locked_by=@beeId,
    locked_by_instance=@instanceId,
    lease_expires_at=datetime('now', '+' || (@hb * 3) || ' seconds'),
    attempts=attempts+1,
    rev=rev+1,
    claimed_at=datetime('now'),
    updated_at=datetime('now')
WHERE id=@taskId AND assigned_to=@beeId AND status='pending';
```

- Si `changes()===1`: éxito → emite `task:status_changed`. Devuelve `{ claimed: true, task }`.
- Si `changes()===0`: la tarea ya no estaba `pending` o no es de ese bee → devuelve `{ claimed: false }` (HTTP 409 en la ruta).

> Nota: `node:sqlite` es síncrono; envuelve el UPDATE + emit con el helper
> `transaction(db, fn, true)` (BEGIN IMMEDIATE) de `src/db/index.ts` (Etapa 1).

**Acción (test):** dos llamadas a `claimTask` sobre la misma tarea `pending`: la primera
devuelve `claimed:true`, la segunda `claimed:false`.

**Verificación:** `npm test` pasa.

---

## Tarea 2.7 — Reportar resultado y transiciones de estado

**Acción:** en `src/api/tasks.service.ts`, agrega `reportResult(db, io, beeId, taskCode, input)`:

1. Verificar que la tarea exista y que `locked_by===beeId` (si no, error `NOT_LEASE_OWNER`, HTTP 409).
2. Insertar en `results` (con `attempt` = `tasks.attempts`, `idempotency_key`). Si la
   `idempotency_key` ya existe para esa tarea (violación de UNIQUE), **no es error**: devuelve
   el resultado existente (idempotente).
3. Transición:
   - `outcome='completed'` → `tasks.status='completed'`, limpiar lock, `rev+1`.
     Luego llamar a `unblockDependents(db, io, taskId)`.
   - `outcome='failed'` → si `attempts < max_attempts`: `status='pending'` (reintento) y limpiar lock;
     si `attempts >= max_attempts`: `status='blocked'`, `block_reason='retries_exhausted'`, y
     llamar `propagateFailure(db, io, taskId)`.
4. Emitir `task:status_changed`. Todo en una transacción.

`unblockDependents(db, io, completedTaskId)`: por cada tarea que dependía de esta, si TODAS sus
dependencias están `completed`, pásala de `blocked`(deps_unresolved) a `pending`, limpia
`block_reason`, `rev+1`, emite evento.

`propagateFailure(db, io, failedTaskId)`: marca los dependientes directos como `blocked` con
`block_reason='upstream_failed'`, `rev+1`, emite evento (NO los reabre).

**Acción (test):** cubre: completar una tarea desbloquea a su dependiente; fallar agotando
`max_attempts` bloquea al dependiente con `upstream_failed`; reportar dos veces con la misma
`idempotency_key` no duplica filas en `results`.

**Verificación:** `npm test` pasa.

---

## Tarea 2.8 — Jobs de mantenimiento

**Acción:** crea `src/api/jobs/maintenance.ts` con una función `runMaintenance(db, io)` que se
llama cada `N` segundos (por defecto cada 15 s; configurable). Hace, en este orden:

1. **Leases/heartbeats vencidos:** bees con `last_heartbeat_at < now - heartbeat_seconds*3`
   → `status='offline'`; liberar sus tareas `in_progress` (`status='pending'`, `locked_by=NULL`,
   `locked_by_instance=NULL`, `lease_expires_at=NULL`, `rev+1`). Emitir `bee:offline`.
2. **Watchdog de tareas atascadas:** tareas `in_progress` con
   `claimed_at < now - COALESCE(max_run_seconds, <default 1800>)` segundos →
   `status='blocked'`, `block_reason='timeout'`, limpiar lock, `rev+1`. Emitir `task:status_changed`.
3. **Retención:** borrar filas de `events` con `created_at < now - <retención, default 7 días>`
   (en Fase 1 no hay cursor multi-cliente; usa solo el umbral de tiempo). No borres `results`
   en esta etapa (solo eventos).

**Acción:** crea `src/api/jobs/scheduler.ts` con `startScheduler(db, io, intervalMs)` que usa
`setInterval` para llamar `runMaintenance`. Debe poder detenerse (devuelve un `stop()`).

**Acción (test):** test que inserta un bee con `last_heartbeat_at` viejo y una tarea
`in_progress`, corre `runMaintenance` una vez, y verifica que el bee quedó `offline` y la tarea `pending`.

**Verificación:** `npm test` pasa.

---

## Tarea 2.9 — Rutas REST + middleware de auth

**Acción:** crea `src/api/middleware/auth.ts`: un middleware Express que lee el header
`Authorization: Bearer <token>`, llama `identifyByToken`, y:
- Si no hay token válido → HTTP 401.
- Si hay → pega `req.identity` (tipo `AuthIdentity`) y sigue.
Y un segundo middleware `requireOperator` que exige `req.identity.isOperator` (si no, HTTP 403).

**Acción:** crea las rutas (una función por archivo en `src/api/routes/`) montadas bajo
`/api/orchestrator`. Cada una valida con zod y delega al servicio:

| Método y ruta | Auth | Servicio |
|---|---|---|
| `POST /bees/register` | bee (token propio) | `registerOrUpdateBee` |
| `PATCH /bees/:id/heartbeat` | bee (debe ser su `:id`) | `heartbeat` |
| `GET /bees` | cualquiera | `listBees` |
| `POST /tasks` | **operador** | `createTask` |
| `GET /tasks` | cualquiera | `listTasks` |
| `POST /tasks/:code/claim` | bee (debe ser `assigned_to`) | `claimTask` (409 si `claimed:false`) |
| `POST /tasks/:code/results` | bee (debe ser dueño del lease) | `reportResult` |
| `PATCH /tasks/:code/status` | **operador** | cambio manual de estado |
| `POST /integrations` | **operador** | (Etapa 3 lo usa; aquí solo registra fila) |
| `GET /integrations` | cualquiera | listar |
| `PATCH /integrations/:id/resolve` | **operador** | marcar resuelta |
| `GET /events?since=<id>` | cualquiera | `SELECT * FROM events WHERE id > ? ORDER BY id` |

> La ejecución real de `git merge`/`cherry-pick` de `POST /integrations` se especifica en la
> Etapa 3 (necesita acceso al worktree). En esta etapa, la ruta solo crea/lee filas de
> `integrations`. Deja un `// TODO Etapa 3: ejecutar git` claramente marcado.

**Acción:** crea `src/api/server.ts` con `createServer(db, options)` que:
- crea la app Express con `express.json()`,
- monta el middleware de auth y las rutas,
- crea el `io` de socket.io sobre el mismo http server,
- **autentica el handshake**: en `io.use(...)`, lee `socket.handshake.auth.token`, valida con
  `identifyByToken`; si falla, rechaza la conexión.
- devuelve `{ app, httpServer, io, listen(port), close() }`.

**Acción (test de integración):** crea `test/api.test.ts` que:
1. crea DB en memoria + esquema, inserta un bee `amalia` (operador) y un `database-bee` con tokens conocidos,
2. levanta el server en un puerto libre,
3. con `fetch`: crea una tarea (token operador), la reclama (token bee), reporta `completed`,
4. verifica vía `GET /tasks` que quedó `completed`,
5. verifica que `GET /tasks` sin token devuelve 401,
6. cierra el server.

**Verificación:** `npm test` → todos los tests de la API pasan.

---

## Reglas de seguridad de esta etapa (revísalas antes de cerrar)

- [ ] Ningún endpoint usa `bee_id`/`bee_name` del body para decidir identidad: siempre `req.identity`.
- [ ] `POST /tasks`, `PATCH /status`, `POST /integrations`, `PATCH /resolve` exigen operador.
- [ ] El servidor hace `listen` en `127.0.0.1` por defecto (no `0.0.0.0`).
- [ ] El handshake de WebSocket exige token válido.
- [ ] Validaste `slug`/`commit`/`nombre-bee` con las regex de `validation.ts` donde apliquen.

---

## Definición de Hecho (Etapa 2)

- [ ] `auth.ts`, `validation.ts`, `events.ts` creados y testeados.
- [ ] `bees.service.ts`, `tasks.service.ts` con claim atómico, resultados, desbloqueo y propagación.
- [ ] `jobs/maintenance.ts` + `scheduler.ts` (leases, watchdog, retención).
- [ ] `middleware/auth.ts` + rutas REST + `server.ts` con WS autenticado.
- [ ] `test/api.test.ts` (flujo crear→reclamar→reportar) en verde.
- [ ] `npm run typecheck` y `npm test` pasan.
