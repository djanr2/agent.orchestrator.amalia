# PLAN 04 — Etapa 4: Motores de Agente (Capa 3)

> Lee primero [`PLAN-00-INDICE.md`](PLAN-00-INDICE.md) y termina las Etapas 1-3.

## Objetivo

Dar a cada bee la capacidad de **conectarse a la API, latir (heartbeat), reclamar tareas,
ejecutarlas y reportar resultados**, funcionando incluso en modo degradado (API caída). Se
construye un **cliente de runtime de bee** reutilizable y un **lanzador** para motores en modo `api`.

## Prerrequisitos

- Etapas 1-3 completas (API + CLI + réplica en archivos).

## Decisiones ya tomadas (no las cambies)

- El **heartbeat corre en un timer independiente del trabajo** (`setInterval`), NO se mezcla con
  el turno del modelo. Esto evita que una tarea larga se interprete como caída (ver especificación).
- El cliente lee su token de `<panal>/orchestrator-api/.secrets/<bee>.token` y su config de `bee.md`.
- En modo degradado, el bee opera solo con archivos `tasks/` locales y marca pendientes de sync.

---

## Tarea 4.1 — Cliente HTTP de la API (SDK del bee)

**Acción:** crea `src/engines/api-client.ts`. Envuelve `fetch` con el token del bee:

- `class OrchestratorClient(baseUrl, token)` con métodos:
  - `register(input)` → `POST /bees/register`.
  - `heartbeat(beeId)` → `PATCH /bees/:id/heartbeat`.
  - `listMyTasks(status?)` → `GET /tasks?assigned_to=<self>`.
  - `claim(code, instanceId)` → `POST /tasks/:code/claim` (devuelve `{claimed, task}`; 409 → `claimed:false`).
  - `reportResult(code, payload)` → `POST /tasks/:code/results`.
- Todos los métodos adjuntan `Authorization: Bearer <token>` y manejan errores HTTP devolviendo
  un resultado tipado `{ ok: true, data } | { ok: false, status, error }` (no lances en flujo normal).

**Verificación:** test con el server de la Etapa 2 en memoria: `register` + `heartbeat` responden ok.

---

## Tarea 4.2 — Lectura de `bee.md` y arranque del runtime

**Acción:** crea `src/engines/bee-config.ts`:
- `readBeeConfig(beeDir)` → parsea `bee.md` (secciones `## Motor`, `## Conexión al Orchestrator API`).
  Devuelve `{ motor, modo_conexion, modelo, heartbeat_segundos, api_base_url, bee_name,
  comando_arranque?, endpoint?, auth_env? }`.
- `readBeeToken(secretsDir, beeName)` → lee `.secrets/<bee>.token`.

**Verificación:** test: parsea un `bee.md` de ejemplo y devuelve los campos esperados.

---

## Tarea 4.3 — Loop de trabajo del bee (runtime)

**Acción:** crea `src/engines/bee-runtime.ts` con `runBee(beeDir, options)`. Implementa el
**Ciclo de vida de un Bee** (especificación → Capa 3):

1. Leer `AGENTS.md` (solo informativo) y `bee.md` (config).
2. `register` y arrancar el **timer de heartbeat** (`setInterval(() => client.heartbeat(id), heartbeat_segundos*1000)`).
3. **Loop de tareas:**
   a. Leer `tasks/tasks.md` local para ver `pending` (funciona aun sin API).
   b. Si hay API: `claim(code, instanceId)`. Si `claimed:false`, pasar a la siguiente.
   c. Escribir el `Lock` en el `tasks/<slug>.task.md` local (`rev+1`).
   d. **Ejecutar la tarea** → aquí se invoca al motor real (ver 4.4) o, en pruebas, un ejecutor simulado.
   e. Escribir `tasks/<slug>.result.md` + actualizar `tasks/results.md` (`rev+1`).
   f. `reportResult(code, { outcome, idempotency_key, ... })`. Si la API no responde, dejar
      el resultado local con `synced_rev` por detrás de `rev` (pendiente de sync).
   g. Repetir hasta que no haya `pending`.
4. Al terminar o recibir señal de paro: limpiar el timer de heartbeat.

> `instanceId`: genera uno por proceso (`randomUUID`) al arrancar; identifica esta instancia
> del bee para el lease (ver especificación → "Lease en vez de PID").

**Verificación:** test de integración con API en memoria + un ejecutor simulado que siempre
devuelve `completed`: el runtime reclama una tarea `pending`, la reporta, y queda `completed` en la DB.

---

## Tarea 4.4 — Adaptadores de motor

**Acción:** crea `src/engines/adapters/` con un adaptador por motor. Interfaz común:

```ts
export interface EngineAdapter {
  /** Ejecuta la tarea y devuelve el resultado para reportar. */
  run(task: TaskSpec, ctx: EngineContext): Promise<EngineResult>;
}
```

Implementa al menos:
- `claude-code.ts` — modo `cli`: lanza el comando `comando_arranque` de `bee.md` con `execFile`,
  pasándole el contexto (la tarea a resolver). Captura stdout para el reporte.
- `ollama.ts` — modo `api`: hace `POST` al `endpoint` del motor con el prompt de la tarea;
  usa la credencial de `process.env[auth_env]` solo si `auth_env` está definido.

> Para los motores CLI (claude-code, opencode, copilot-cli, codex-cli) el patrón es el mismo:
> construir el comando desde `bee.md` y ejecutarlo. Empieza por `claude-code` y `ollama`; los
> demás se agregan replicando el patrón, sin cambiar la interfaz.

**Seguridad (recordatorio):** al lanzar un subproceso de motor, pásale **solo** la variable
`auth_env` declarada (más las imprescindibles), no todo `process.env` (ver especificación →
"Aislamiento de secretos entre motores").

**Verificación:** test del adaptador `ollama` con un `endpoint` simulado (servidor local de
prueba) que devuelve una respuesta fija.

---

## Tarea 4.5 — Lanzador genérico (`amalia` arranca un bee)

**Acción:** integra con el CLI: agrega un comando interno o un script `src/engines/launch.ts`
que, dado un `beeDir`, selecciona el adaptador según `bee.md` (`motor`) y llama a `runBee`.
Esto es lo que se ejecuta cuando un bee "vive".

**Verificación:** documenta y prueba: con la API arriba, una tarea `pending` asignada a un bee
simulado se completa al lanzar su runtime.

---

## Errores comunes a evitar

- **No** hagas el heartbeat dentro del loop de trabajo: debe ser un `setInterval` aparte.
- **No** asumas que la API siempre responde: maneja el modo degradado (archivos locales).
- **No** filtres `process.env` completo a los subprocesos de motor.

---

## Definición de Hecho (Etapa 4)

- [ ] `api-client.ts` (SDK del bee) con tests contra la API real en memoria.
- [ ] `bee-config.ts` (lee `bee.md` y token).
- [ ] `bee-runtime.ts` con heartbeat independiente y loop reclamar→ejecutar→reportar + modo degradado.
- [ ] Adaptadores `claude-code` y `ollama` (mínimo), con la interfaz común.
- [ ] Lanzador que selecciona adaptador por `bee.md`.
- [ ] `npm run typecheck` y `npm test` pasan.
