# Especificación de Arquitectura: Amalia — Orquestador Multi-Agente

## Visión General

**Amalia** es un sistema que permite a **múltiples motores de IA** (Claude Code, opencode, GitHub Copilot CLI, OpenAI Codex CLI, modelos locales vía Ollama, etc.) coordinarse como un enjambre de trabajo, usando la metáfora de una colmena:

- **Amalia** — el orquestador principal. Analiza el requerimiento general sobre el **repositorio original**, lo descompone en tareas y supervisa el progreso del enjambre. Amalia es en sí misma un `git worktree`.
- **Bees** — los workers especializados. Cada uno tiene un rol independiente (ej. `database-bee`, `frontend-bee`, `infrastructure-bee`) y desarrolla su tarea en su propio worktree, sin pisar el trabajo de los demás.
- **Honeycomb** — el directorio raíz que contiene los worktrees: el de Amalia y el de cada bee. Es el panal donde vive el enjambre.

La comunicación entre Amalia y los bees ya **no es vía archivos**: es vía una **base de datos SQLite** que actúa como cola de tareas y fuente de verdad única. Amalia escribe tareas en la base; cada bee las reclama y reporta resultados ahí mismo. Esto se expone mediante una API/WebSocket (Capa 1, ahora **obligatoria**) y opcionalmente un dashboard (Capa 2). Cada worktree puede estar potenciado por un motor de IA distinto, declarado en su propio `bee.md` (ver Capa 3).

## Arquitectura por Capas

```
 Capa 2 — Dashboard Web (panal visual)                          [opcional]
        │ lee/escribe vía REST + WebSocket
        ▼
 Capa 1 — Orchestrator API (Node.js/TypeScript + SQLite)        [OBLIGATORIA]
        │ única fuente de verdad: la base de datos
        ▼
 Capa 0 — Modelo de Datos (SQLite: bees, tasks, results, events) [OBLIGATORIA]
        ▲
        │ leen/escriben vía REST o cliente SQLite directo
 Capa 3 — Motores de Agente (Amalia y Bees)                      [OBLIGATORIA]
   (Claude Code, opencode, Copilot CLI, Codex CLI, Ollama, etc.)
```

- **Capa 0 (Modelo de Datos)**: la base de datos SQLite es la única fuente de verdad. Se eligió SQLite (y no Postgres/MySQL) porque se instala localmente sin depender de un servicio de base de datos externo — un solo archivo `.db` dentro del repositorio de Amalia.
- **Capa 1 (Orchestrator API)**: **obligatoria**. Servicio Node.js/TypeScript que es el único proceso con acceso de escritura directo a la SQLite; expone REST + WebSocket para que Amalia, los bees y el dashboard interactúen con la cola de tareas.
- **Capa 2 (Dashboard)**: opcional. Cliente web que consume la Capa 1.
- **Capa 3 (Motores de Agente)**: Amalia y cada bee son sesiones de un motor de IA (CLI o API) que hablan con la Capa 1 — nunca tocan la base de datos directamente, siempre a través del API/cliente.

### Diagrama del flujo Amalia ↔ Bees (vía SQLite)

```
                      ┌─────────────────────┐
                      │       AMALIA        │
                      │  (worktree propio)  │
                      └──────────┬──────────┘
                                 │ REST/WS: crea tareas, lee resultados
                                 ▼
                      ┌─────────────────────┐
                      │  Orchestrator API   │
                      │   (Node.js + TS)    │
                      └──────────┬──────────┘
                                 │
                                 ▼
                      ┌─────────────────────┐
                      │   amalia.db (SQLite)│
                      │ tablas: bees, tasks, │
                      │ results, events      │
                      └──────────┬──────────┘
                                 │ REST/WS: reclama tareas, reporta resultados
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       ┌─────────────────┐             ┌─────────────────┐
       │  database-bee    │             │  frontend-bee    │
       │  (Claude Code)    │             │  (opencode)      │
       │  bee.md           │             │  bee.md          │
       └─────────────────┘             └─────────────────┘
```

## Estructura de Directorios (Honeycomb)

```
honeycomb/
├── amalia/                      # Worktree del orquestador principal
│   ├── AGENTS.md                  # Rol y alcance de Amalia
│   └── bee.md                     # Motor de IA de Amalia (mismo esquema que un bee)
├── database-bee/                # Worktree: especialista en base de datos
│   ├── AGENTS.md                  # Rol, alcance, límites (negocio)
│   └── bee.md                     # Motor de IA + conexión (técnico)
├── backend-api-bee/              # Worktree: especialista en API REST
│   ├── AGENTS.md
│   └── bee.md
├── frontend-bee/                 # Worktree: especialista en frontend
│   ├── AGENTS.md
│   └── bee.md
├── infrastructure-bee/           # Worktree: DevOps/infra
│   ├── AGENTS.md
│   └── bee.md
├── orchestrator-api/             # Capa 1: servicio Node.js/TypeScript (obligatorio, no es worktree)
│   └── amalia.db                   # Base de datos SQLite (fuente de verdad)
├── dashboard/                    # Capa 2: cliente web (opcional, no es worktree)
└── shared/                       # Recursos compartidos (opcional, no es worktree)
    ├── interfaces/                 # Contratos entre módulos
    └── docs/                       # Documentación global
```

- `amalia/` y `*-bee/` son **worktrees reales de Git** (`git worktree add honeycomb/database-bee <rama>`), todos apuntando al mismo repositorio original.
- `orchestrator-api/`, `dashboard/` y `shared/` son carpetas normales (no worktrees) — infraestructura propia de Amalia, no entregables del repositorio orquestado.
- Convención de nombres: todo bee usa el sufijo `-bee` (`database-bee`, `frontend-bee`, `infrastructure-bee`, `payments-bee`, etc.).

## Capa 0 — Modelo de Datos (SQLite)

La base de datos vive en `orchestrator-api/amalia.db` y es la **única fuente de verdad**. Ningún worktree edita esta base directamente: siempre a través del API de la Capa 1.

### Esquema (DDL)

```sql
-- Un bee (o el propio Amalia) registrado en el sistema
CREATE TABLE bees (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,        -- 'amalia', 'database-bee', 'frontend-bee'...
  worktree_path   TEXT NOT NULL,               -- 'honeycomb/database-bee'
  role_summary    TEXT,                        -- resumen corto extraído de AGENTS.md
  engine          TEXT NOT NULL,               -- 'claude-code' | 'opencode' | 'copilot-cli' | 'codex-cli' | 'ollama' | 'custom'
  connection_mode TEXT NOT NULL,               -- 'cli' | 'api'
  model           TEXT,                        -- 'claude-sonnet-4-6', 'llama3.1:70b', ...
  status          TEXT NOT NULL DEFAULT 'offline', -- 'offline' | 'idle' | 'busy'
  heartbeat_seconds INTEGER NOT NULL DEFAULT 60,
  last_heartbeat_at TEXT,                      -- ISO timestamp
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cola de tareas (también cumple el rol de message queue)
CREATE TABLE tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,         -- 'TASK-001'
  assigned_to     INTEGER NOT NULL REFERENCES bees(id),
  created_by      INTEGER NOT NULL REFERENCES bees(id), -- normalmente 'amalia'
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'claimed'|'in_progress'|'completed'|'blocked'|'failed'
  priority        TEXT NOT NULL DEFAULT 'medium',  -- 'high'|'medium'|'low'
  description     TEXT NOT NULL,
  acceptance_criteria TEXT,
  locked_by       INTEGER REFERENCES bees(id),     -- bee que reclamó la tarea
  locked_pid      INTEGER,
  claimed_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Dependencias entre tareas (n:n)
CREATE TABLE task_dependencies (
  task_id            INTEGER NOT NULL REFERENCES tasks(id),
  depends_on_task_id INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_task_id)
);

-- Reportes de resultado de cada tarea
CREATE TABLE results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL REFERENCES tasks(id),
  bee_id        INTEGER NOT NULL REFERENCES bees(id),
  outcome       TEXT NOT NULL,               -- 'completed' | 'failed'
  files_changed TEXT,                        -- JSON: ["path1 (creado)", "path2 (modificado)"]
  decisions     TEXT,
  blockers      TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bitácora de eventos, también usada para reproducir el WebSocket tras una caída
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,                 -- 'task:created' | 'task:status_changed' | 'bee:registered' | 'bee:heartbeat'
  payload     TEXT NOT NULL,                 -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Modelo de trabajo: la cola de mensajes vive en SQLite

En vez de un broker externo (RabbitMQ u otro), la cola de mensajes **es la propia tabla `tasks`**, con reclamo atómico vía SQL y notificación en tiempo real vía WebSocket (Capa 1). Esto evita una segunda dependencia de infraestructura — coherente con la razón por la que se eligió SQLite sobre Postgres: cero servicios externos, todo corre embebido en un solo proceso Node.js.

**Reclamo atómico de una tarea** (lo ejecuta la Capa 1 a pedido del bee, nunca el bee directamente sobre el archivo `.db`):

```sql
UPDATE tasks
SET status = 'in_progress', locked_by = :bee_id, locked_pid = :pid, claimed_at = datetime('now'), updated_at = datetime('now')
WHERE id = :task_id AND assigned_to = :bee_id AND status = 'pending';
-- Si changes() = 1 -> el bee obtuvo la tarea.
-- Si changes() = 0 -> otra ejecución ya la tomó (o ya no está pending); el bee debe pedir la siguiente.
```

Esta atomicidad (gracias a que SQLite serializa escrituras) es exactamente lo que da semántica de cola sin necesitar un broker dedicado: "como máximo un consumidor obtiene cada mensaje".

### Ciclo de vida de una tarea

```
pending → (claim atómico) → in_progress → completed
                                       └─→ failed
pending/in_progress → blocked  (dependencias no resueltas, o reintentos agotados)
in_progress → pending  (lock expirado: bee caído, ver más abajo)
```

- Cuando todas las `task_dependencies` de una tarea `blocked` pasan a `completed`, la Capa 1 la mueve automáticamente a `pending` y emite `task:status_changed`.
- Cuando una tarea pasa a `completed` o `failed`, la Capa 1 inserta el evento correspondiente y lo emite por WebSocket; Amalia decide los próximos pasos.

### Heartbeats y recuperación de bees caídos

- Cada bee activo hace `PATCH /api/orchestrator/bees/:id/heartbeat` cada `heartbeat_seconds` (declarado en su `bee.md`).
- La Capa 1 corre un job periódico: si `now - last_heartbeat_at > heartbeat_seconds * 3`, marca el bee como `offline` y libera sus tareas `in_progress` (`status='pending'`, `locked_by=NULL`) para que otro proceso del mismo bee (al reiniciar) o el propio bee tras reconectar pueda reclamarlas de nuevo.

## Capa 3 — Modelo de Ejecución (Motores de Agente)

### `AGENTS.md` vs `bee.md`

Cada worktree (Amalia o un bee) tiene **dos archivos con responsabilidades separadas**:

- **`AGENTS.md`** — el **contrato de negocio**: rol, alcance, límites, stack del proyecto, dependencias con otros bees. Esto es lo que el motor de IA lee para saber *qué puede y no puede hacer*. No cambia según qué IA esté detrás.
- **`bee.md`** — la **configuración técnica del motor**: qué IA ejecuta este worktree y cómo se conecta. Separarlo de `AGENTS.md` permite cambiar de motor (de Claude Code a opencode, por ejemplo) sin tocar una sola línea del contrato de rol/alcance.

```markdown
# AGENTS.md — database-bee

## Rol
Especialista en base de datos y modelos JPA.

## Alcance
- Crear/modificar entidades JPA
- Crear/modificar repositorios
- Migraciones de esquema
- Optimización de consultas

## Stack del proyecto
- Java 19
- Spring Boot 4.0.2
- PostgreSQL
- JPA / Hibernate

## Límites
- NO modificar controladores REST
- NO modificar servicios de negocio
- NO tocar frontend

## Dependencias
- Debe consultar a `backend-api-bee` antes de cambiar interfaces compartidas
```

```markdown
# bee.md — database-bee

## Motor
- **motor**: claude-code
- **modo_conexion**: cli
- **modelo**: claude-sonnet-4-6
- **comando_arranque**: `claude --permission-mode acceptEdits -p "Lee AGENTS.md, conéctate al Orchestrator API y procesa tus tareas"`
- **heartbeat_segundos**: 60

## Conexión al Orchestrator API
- **api_base_url**: http://localhost:4000/api/orchestrator
- **bee_name**: database-bee
```

Para un bee en modo `api` (sin CLI interactivo), `bee.md` declara el endpoint del motor en vez del comando de arranque:

```markdown
# bee.md — analytics-bee

## Motor
- **motor**: ollama
- **modo_conexion**: api
- **modelo**: llama3.1:70b
- **endpoint**: http://localhost:11434/api/generate
- **auth_env**: (vacío — Ollama local no requiere credencial)
- **heartbeat_segundos**: 30

## Conexión al Orchestrator API
- **api_base_url**: http://localhost:4000/api/orchestrator
- **bee_name**: analytics-bee
```

```markdown
# bee.md — payments-bee

## Motor
- **motor**: codex-cli
- **modo_conexion**: api
- **modelo**: gpt-5-codex
- **endpoint**: https://api.openai.com/v1
- **auth_env**: OPENAI_API_KEY
- **heartbeat_segundos**: 60

## Conexión al Orchestrator API
- **api_base_url**: http://localhost:4000/api/orchestrator
- **bee_name**: payments-bee
```

Reglas de `bee.md`:
- `motor` es un identificador conocido por el lanzador (`claude-code`, `opencode`, `copilot-cli`, `codex-cli`, `ollama`, `custom`).
- Las credenciales **nunca** se escriben en `bee.md`; solo se referencia el nombre de la variable de entorno (`auth_env`).
- `heartbeat_segundos` es el intervalo que la Capa 1 espera para considerar al bee vivo.
- Añadir un nuevo motor (Gemini CLI, Cursor CLI, etc.) es agregar un nuevo valor de `motor`, sin cambiar el esquema.

### Ciclo de vida de Amalia

1. **Arranque**: sesión CLI (o API) en `honeycomb/amalia/`, según su propio `bee.md`.
2. **Registro**: `POST /api/orchestrator/bees/register` (si no existe ya).
3. **Análisis**: lee el requerimiento del repositorio original y lo descompone en tareas.
4. **Publicación**: `POST /api/orchestrator/tasks` por cada tarea, con `assigned_to` y `depends_on`.
5. **Escucha**: se suscribe al WebSocket (`task:status_changed`, eventos de resultado) o hace polling de `GET /api/orchestrator/tasks?status=completed,failed`.
6. **Decisión**: ante un resultado, crea nuevas tareas, desbloquea dependientes, o marca el trabajo global como terminado.

### Ciclo de vida de un Bee

1. **Arranque**: sesión CLI o lanzador API en `honeycomb/<nombre-bee>/`, según `bee.md`.
2. **Lectura de contrato**: lee `AGENTS.md` (rol/límites) y `bee.md` (su propia configuración de motor).
3. **Registro y heartbeat**: `POST /api/orchestrator/bees/register`, luego `PATCH /api/orchestrator/bees/:id/heartbeat` cada `heartbeat_segundos`.
4. **Reclamo de tarea**: `POST /api/orchestrator/tasks/:id/claim` (la Capa 1 ejecuta el `UPDATE` atómico descrito en Capa 0). Si pierde la carrera, pide la siguiente tarea `pending` asignada a su nombre.
5. **Ejecución**: usa sus propias herramientas (Read/Edit/Bash/etc.) para resolver la tarea dentro de su worktree.
6. **Reporte**: `POST /api/orchestrator/tasks/:id/results` con el outcome (`completed`/`failed`) y detalle; la Capa 1 actualiza `tasks.status` y emite el evento.
7. **Repetición o cierre**: vuelve a pedir trabajo, o termina la sesión si no hay tareas pendientes — decisión operativa, no estructural.

## Capa 1 — Orchestrator API (Node.js / TypeScript) — Obligatoria

Es el **único** proceso con acceso de escritura a `amalia.db`. Todo el resto del sistema (Amalia, bees, dashboard) habla con esta API — nunca con la base de datos directamente.

### API REST
- `POST /api/orchestrator/bees/register` — registrar/actualizar un bee (nombre, worktree, motor, modelo, modo de conexión)
- `PATCH /api/orchestrator/bees/:id/heartbeat` — marcar latido de vida
- `GET /api/orchestrator/bees` — listar bees y su estado/motor
- `POST /api/orchestrator/tasks` — crear tarea (usado por Amalia)
- `GET /api/orchestrator/tasks` — listar tareas (filtros por estado/bee)
- `POST /api/orchestrator/tasks/:id/claim` — reclamo atómico de una tarea (usado por un bee)
- `POST /api/orchestrator/tasks/:id/results` — reportar resultado (usado por un bee)
- `PATCH /api/orchestrator/tasks/:id/status` — actualización manual de estado (uso administrativo/dashboard)

### WebSocket (Socket.io)
- Eventos: `task:created`, `task:status_changed`, `bee:registered`, `bee:heartbeat`, `bee:offline`
- Es la forma recomendada en que Amalia y los bees se enteran de cambios sin hacer polling constante; el polling vía REST queda como respaldo si el cliente no mantiene conexión WS.

### Job de mantenimiento interno
- Cada `N` segundos: revisa bees con heartbeat vencido → los marca `offline` y libera sus tareas `in_progress`.
- Cada vez que una tarea pasa a `completed`: revisa `task_dependencies` y desbloquea las tareas `blocked` que ya cumplen todas sus dependencias.

### Stack
- Node.js + TypeScript
- Socket.io para tiempo real
- SQLite (`better-sqlite3` o `node:sqlite`) — única opción, sin alternativa Postgres (decisión fija: cero servicios externos)

## Capa 2 — Dashboard Web (Opcional)

Cliente que consume exclusivamente la API/WebSocket de la Capa 1:

- Tablero de bees activos, con su motor de IA visible (Claude Code, opencode, Ollama, etc.)
- Cola de tareas con filtros por estado/bee
- Vista de detalle de tarea + historial de reportes (tabla `results`)
- Capacidad de crear tareas manualmente desde la UI

Stack sugerido: HTML + JS vanilla o un framework ligero (Svelte/React), consumiendo el WebSocket para refresco en tiempo real.

## Roadmap de Fases

### Fase 1 — Modelo de Datos y Orchestrator API (Capas 0+1, base obligatoria)
- [ ] Esquema SQLite (`bees`, `tasks`, `task_dependencies`, `results`, `events`)
- [ ] Servicio Node.js/TypeScript con las rutas REST descritas
- [ ] Reclamo atómico de tareas (`/tasks/:id/claim`)
- [ ] Job de heartbeats vencidos y desbloqueo de dependencias
- [ ] WebSocket (Socket.io) con los eventos descritos
- [ ] Templates de `AGENTS.md` y `bee.md`
- [ ] Convención de nomenclatura `<área>-bee`

### Fase 2 — Integración con motores (Capa 3)
- [ ] Cliente/skill para Claude Code que se registra, hace heartbeat, reclama tareas y reporta vía API
- [ ] Mismo cliente para opencode, Copilot CLI y Codex CLI
- [ ] Lanzador genérico para motores en `modo_conexion: api` (Ollama y otros)

### Fase 3 — Dashboard web (Capa 2, opcional)
- [ ] Tablero de bees activos (con motor visible)
- [ ] Cola de tareas con filtros por estado/bee
- [ ] Vista de detalle de tarea + historial de reportes
- [ ] Creación manual de tareas desde la UI

## Consideraciones Técnicas

- **Git Worktrees**: `amalia/` y cada `*-bee/` son worktrees reales (`git worktree add`) del repositorio original bajo `honeycomb/`.
- **Fuente de verdad única**: la SQLite (`amalia.db`) reemplaza por completo al protocolo de archivos de versiones anteriores; ningún worktree lee/escribe tareas directamente en disco fuera de la API.
- **Cola de mensajes embebida**: la tabla `tasks` + reclamo atómico (`UPDATE ... WHERE status='pending'`) cumple el rol de un broker tipo RabbitMQ sin añadir un segundo servicio de infraestructura.
- **Multi-motor**: cada worktree declara su motor en `bee.md`, separado del contrato de rol en `AGENTS.md`. Cambiar de motor no afecta el contrato de negocio.
- **Seguridad de credenciales**: ninguna API key se escribe en `bee.md` ni se versiona en Git; solo se referencian nombres de variables de entorno (`auth_env`).
- **Detección de bees caídos**: heartbeat vía WebSocket/REST comparado contra `heartbeat_segundos`; un bee caído libera automáticamente sus tareas `in_progress`.
- **Escalabilidad**: si en el futuro se necesita multi-host, la API es el único punto que tendría que migrar de SQLite a Postgres — el resto del sistema (bees, dashboard) no se entera, porque siempre habla con la API, nunca con la base directamente.

## Tecnologías

| Componente | Tecnología |
|-----------|------------|
| Orchestrator API (Capa 1) | Node.js + TypeScript |
| Base de datos / cola de mensajes (Capa 0) | SQLite (`better-sqlite3` o `node:sqlite`) |
| WebSocket | Socket.io |
| Dashboard (Capa 2) | HTML + JS vanilla / Svelte / React |
| Motores de Amalia/Bees (Capa 3) | Claude Code, opencode, Copilot CLI, Codex CLI, Ollama (modelos locales), u otros vía API |
| Control de versiones | Git con worktrees (`honeycomb/`) |

---

*Documento de especificación v4.0 — Amalia: SQLite como fuente de verdad obligatoria y cola de mensajes embebida, separación `AGENTS.md` (contrato de rol) / `bee.md` (configuración de motor), ciclos de vida explícitos de Amalia y los bees vía Orchestrator API*
