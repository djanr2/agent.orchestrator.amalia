# Especificación de Arquitectura: Amalia — Orquestador Multi-Agente

## Visión General

**Amalia** es un sistema que permite a **múltiples motores de IA** (Claude Code, opencode, GitHub Copilot CLI, OpenAI Codex CLI, modelos locales vía Ollama, etc.) coordinarse como un enjambre de trabajo, usando la metáfora de una colmena:

- **Amalia** — el orquestador principal. Analiza el requerimiento general sobre el **repositorio original**, lo descompone en tareas y supervisa el progreso del enjambre. Amalia es en sí misma un `git worktree`.
- **Bees** — los workers especializados. Cada uno tiene un rol independiente (ej. `database-bee`, `frontend-bee`, `infrastructure-bee`) y desarrolla su tarea en su propio worktree, sin pisar el trabajo de los demás.
- **Honeycomb** — el directorio raíz que contiene los worktrees: el de Amalia y el de cada bee. Es el panal donde vive el enjambre.

La comunicación primaria entre Amalia y los bees es vía una **base de datos SQLite** que actúa como cola de tareas y fuente de verdad única — Amalia escribe tareas en la base; cada bee las reclama y reporta resultados ahí mismo, todo a través de una API/WebSocket (Capa 1, **obligatoria**).

Pero **la estructura de archivos (`TASKS.md`/`RESULTS.md`) se mantiene como réplica local en cada worktree**. La Capa 1 replica en disco cada tarea que asigna a un bee, y cada bee replica en disco cada resultado que reporta — además de enviarlo a la base. Esto da **resiliencia ante caída de la base de datos**: si `amalia.db` o el Orchestrator API se caen, cada bee ya tiene su tarea escrita en su propio `TASKS.md` local y puede seguir trabajando de forma independiente, reportando en su `RESULTS.md` local. Cuando la base vuelve, se sincroniza (ver Capa 0 → "Modo degradado y reconciliación"). Cada worktree puede además estar potenciado por un motor de IA distinto, declarado en su propio `bee.md` (ver Capa 3).

## Roles y Alcance

### Amalia — Orquestador

**Rol**: coordinar el enjambre. Amalia **nunca escribe código de la aplicación**; su trabajo es de gestión y de integración del trabajo ya hecho por los bees.

Alcance:
- Analizar el requerimiento general sobre el repositorio original y descomponerlo en tareas.
- Crear y eliminar bees (`amalia hatch` / `amalia kill`).
- Publicar tareas y resolver dependencias entre ellas (`amalia task add`, desbloqueo automático).
- Supervisar el progreso (`amalia check`, `amalia logs`).
- **Integrar a la rama principal** el trabajo ya completado por un bee (`amalia integrate`, ver más abajo).
- Reaccionar ante fallos o bloqueos: reasignar, reabrir tareas, marcar conflictos para intervención humana.

Límites:
- NO escribe ni edita código de negocio directamente — eso es trabajo exclusivo de los bees, cada uno dentro de su `AGENTS.md`.
- NO resuelve conflictos de merge de Git — los detecta y los reporta; la resolución es responsabilidad de un humano.
- NO decide detalles de implementación dentro del dominio de un bee (cómo modelar una entidad, qué librería usar, etc.) — solo define **qué** se necesita, no **cómo**.

### Bee — Worker especializado

**Rol**: ejecutar tareas dentro de su área de responsabilidad, declarada en su propio `AGENTS.md`.

Alcance:
- Reclamar y ejecutar las tareas que Amalia le asigna, dentro de su propio worktree/rama.
- Hacer commits locales en la rama de su worktree a medida que avanza.
- Reportar resultados (`RESULTS.md` + API) con suficiente detalle para que Amalia pueda integrar el trabajo sin tener que leer el código.

Límites:
- NO hace merge/integra sus propios cambios a la rama principal — solo Amalia integra, vía `amalia integrate`.
- NO opera fuera del alcance y los límites declarados en su `AGENTS.md` (ver ejemplo de `database-bee` en la Capa 3).
- NO decide la arquitectura global ni crea/elimina otros bees — eso es exclusivo de Amalia.

## Distribución e Instalación (npm)

Amalia se distribuye como un **paquete npm con un binario CLI** (`amalia`), instalable en cualquier repositorio Git que ya tenga Node.js disponible:

```bash
npm install -g amalia        # instalación global del CLI
# o, sin instalar globalmente:
npx amalia init
```

- **`amalia init`** — ejecutado en la raíz de un repositorio Git existente. Crea la carpeta `honeycomb/`, el worktree `honeycomb/amalia/` (con sus `AGENTS.md`/`bee.md` por defecto), la carpeta `honeycomb/orchestrator-api/` con `amalia.db` ya con el esquema de la Capa 0 aplicado, y un marcador `.amalia-root` en la raíz del repo que el CLI usa para ubicar el panal desde cualquier subdirectorio.
- A partir de ahí, **no se crean bees automáticamente** — Amalia (el orquestador) decide cuándo "hace eclosionar" (`hatch`) un nuevo bee según las tareas que identifique, vía el CLI (ver siguiente sección).
- El CLI detecta el panal buscando `.amalia-root` hacia arriba desde el directorio actual, así que los comandos funcionan tanto parado en la raíz del repo como dentro de `honeycomb/amalia/` o de cualquier `*-bee/`.

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

- **Capa 0 (Modelo de Datos)**: la base de datos SQLite es la fuente de verdad principal. Se eligió SQLite (y no Postgres/MySQL) porque se instala localmente sin depender de un servicio de base de datos externo — un solo archivo `.db` dentro del repositorio de Amalia. Cada worktree mantiene además una **réplica local en archivos** (`TASKS.md`/`RESULTS.md`) de sus propias tareas, para poder seguir operando si la base no está disponible.
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

`honeycomb/` se crea dentro del repositorio Git objetivo al ejecutar `amalia init` (ver "Distribución e Instalación"). El marcador `.amalia-root` vive en la raíz del repo, junto a `honeycomb/`:

```
<raíz-del-repo>/
├── .amalia-root                 # Marcador que el CLI usa para ubicar el panal
└── honeycomb/
├── amalia/                      # Worktree del orquestador principal
│   ├── AGENTS.md                  # Rol y alcance de Amalia
│   ├── bee.md                     # Motor de IA de Amalia (mismo esquema que un bee)
│   ├── TASKS.md                   # Réplica local: tareas globales que Amalia ha publicado
│   └── RESULTS.md                 # Réplica local: agregado de resultados recibidos
├── database-bee/                # Worktree: especialista en base de datos
│   ├── AGENTS.md                  # Rol, alcance, límites (negocio)
│   ├── bee.md                     # Motor de IA + conexión (técnico)
│   ├── TASKS.md                   # Réplica local de sus tareas asignadas (sincronizada con la DB)
│   └── RESULTS.md                 # Réplica local de sus reportes (sincronizada con la DB)
├── backend-api-bee/              # Worktree: especialista en API REST
│   ├── AGENTS.md
│   ├── bee.md
│   ├── TASKS.md
│   └── RESULTS.md
├── frontend-bee/                 # Worktree: especialista en frontend
│   ├── AGENTS.md
│   ├── bee.md
│   ├── TASKS.md
│   └── RESULTS.md
├── infrastructure-bee/           # Worktree: DevOps/infra
│   ├── AGENTS.md
│   ├── bee.md
│   ├── TASKS.md
│   └── RESULTS.md
├── orchestrator-api/             # Capa 1: servicio Node.js/TypeScript (obligatorio, no es worktree)
│   └── amalia.db                   # Base de datos SQLite (fuente de verdad principal)
├── dashboard/                    # Capa 2: cliente web (opcional, no es worktree)
└── shared/                       # Recursos compartidos (opcional, no es worktree)
    ├── interfaces/                 # Contratos entre módulos
    └── docs/                       # Documentación global
```

El paquete npm `amalia` provee el binario `amalia` (carpeta `bin/` del paquete) y el código del Orchestrator API; no se versiona dentro del repo objetivo más que lo que `amalia init` genera en `honeycomb/`.

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

-- Intentos de integración de un bee a la rama principal
CREATE TABLE integrations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  bee_id           INTEGER NOT NULL REFERENCES bees(id),
  task_id          INTEGER REFERENCES tasks(id),     -- tarea que originó el commit, si aplica
  commit_sha       TEXT,                             -- commit específico, o NULL = último de la rama del bee
  target_branch    TEXT NOT NULL DEFAULT 'main',
  status           TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'success'|'conflict'|'aborted'
  conflicting_files TEXT,                            -- JSON: ["path1", "path2"] cuando status='conflict'
  resolved_by      TEXT,                              -- 'amalia' | nombre de quien resolvió manualmente
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at      TEXT
);

-- Bitácora de eventos, también usada para reproducir el WebSocket tras una caída
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,                 -- 'task:created' | 'task:status_changed' | 'bee:registered' | 'bee:heartbeat' | 'integration:conflict' | 'integration:success'
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

### Réplica en archivos: `TASKS.md` y `RESULTS.md`

La base de datos es la fuente de verdad, pero **cada worktree mantiene una copia local en archivos** de sus propios datos, escrita por la Capa 1 (para tareas asignadas) y por el propio bee (para resultados):

```markdown
# TASKS.md — database-bee (réplica local, sincronizada con amalia.db)

### TASK-001
- **Estado**: pending
- **Asignado a**: database-bee
- **Prioridad**: high
- **Depende de**: TASK-000
- **Descripción**: Crear entidad `ExperimentRun` con campos: id, nombre, fecha_inicio, estado, id_dataset (FK)
- **Criterios de aceptación**:
  - Entidad creada con anotaciones JPA correctas
  - Repositorio CRUD generado
  - Migración o ddl-auto actualizado
- **Lock**: <vacío>
- **Última sincronización con DB**: 2026-06-27T10:00:00Z
```

```markdown
# RESULTS.md — database-bee (réplica local, sincronizada con amalia.db)

## TASK-001: Crear entidad ExperimentRun

### Estado: ✅ Completado

### Archivos creados/modificados
- `src/main/java/.../entity/ExperimentRunEntity.java` (creado)
- `src/main/java/.../repository/ExperimentRunRepository.java` (creado)

### Decisiones
- Se usó `GenerationType.IDENTITY` para el ID

### Bloqueos / Pendientes
- Ninguno

### Sincronizado con DB
- Sí (2026-06-27T10:15:00Z)
```

- Cuando Amalia publica una tarea (`POST /tasks`), la Capa 1 la inserta en `amalia.db` **y** escribe/actualiza la fila correspondiente en el `TASKS.md` del worktree destino.
- Cuando un bee reclama (`/claim`) o reporta (`/results`) una tarea, **primero actualiza su copia local** (`TASKS.md`/`RESULTS.md`) y luego llama a la API para persistir en `amalia.db`. Si la llamada a la API falla, el bee sigue operando solo con el archivo local — la tarea queda con el campo `Última sincronización con DB` desactualizado, marcando que hay cambios pendientes de subir.

### Modo degradado y reconciliación

Si `amalia.db` o el Orchestrator API caen, toda la colmena entra en **modo degradado**, pero no se detiene:

1. Cada bee ya tiene su(s) tarea(s) asignada(s) en su `TASKS.md` local — puede seguir reclamando (marcando `Lock` localmente), ejecutando y reportando en su `RESULTS.md` local sin depender de la base.
2. Amalia, si también pierde la API, puede seguir leyendo los `RESULTS.md` locales de cada worktree directamente (son archivos en el mismo filesystem/worktrees) para decidir próximos pasos, igual que en el protocolo de archivos original.
3. Al recuperarse el Orchestrator API, corre una **reconciliación**: por cada worktree, compara el campo `Última sincronización con DB` de `TASKS.md`/`RESULTS.md` contra `tasks.updated_at`/`results.created_at` en la base.
   - Si el archivo local tiene cambios más recientes que la base (la tarea avanzó de estado o se generó un resultado mientras la DB estaba caída), la Capa 1 los aplica a la base (`INSERT`/`UPDATE`) y emite los eventos correspondientes.
   - Si la base tiene tareas nuevas creadas por Amalia que el worktree no recibió (porque la API estaba caída al momento de crearlas), la Capa 1 las escribe ahora en el `TASKS.md` local de ese bee.
   - No hay conflictos de doble escritor sobre la misma tarea: cada tarea solo es modificada por el bee al que está `assigned_to`, así que la reconciliación es de "quién tiene la versión más nueva", no de fusión de cambios concurrentes.

### Integración a la rama principal (`amalia integrate`)

Los bees nunca hacen merge de su propio trabajo: solo Amalia integra, usando comandos de Git estándar (`git merge`/`git cherry-pick`) desde su propio worktree (`honeycomb/amalia/`), que apunta a la rama principal del repositorio original.

**`amalia integrate <nombre-bee> [<commit>]`**:
1. Crea una fila en `integrations` con `status='pending'`.
2. Si se da `<commit>`, Amalia ejecuta `git cherry-pick <commit>` sobre la rama principal; si no se da, integra el último commit (o todos los commits nuevos) de la rama del worktree del bee con `git merge --no-ff <rama-del-bee>`.
3. **Si no hay conflictos**: el merge/cherry-pick se completa, `integrations.status` pasa a `success`, se emite `integration:success`. El commit queda en la rama principal del worktree de Amalia, listo para que un humano decida cuándo hacer `git push`.
4. **Si hay conflictos**: Git deja el merge a medias (working tree con marcadores `<<<<<<<`). Amalia detecta esto (`git status` reporta `UU`/conflicto), **no intenta resolverlo**, y:
   - Guarda en `integrations` el `status='conflict'` junto con la lista de `conflicting_files`.
   - Emite el evento `integration:conflict` (vía WebSocket y bitácora `events`) para que quede visible en `amalia check`/el dashboard.
   - Deja el repositorio en ese estado de conflicto intencionalmente — la resolución es trabajo humano con las herramientas de Git que prefiera (`git mergetool`, edición manual, etc.).
5. Un humano resuelve el conflicto, hace `git add`/`git commit` (o `git merge --abort` si decide descartar la integración) y corre `amalia integrate --resolve <integration-id>` para que Amalia marque `integrations.status='success'` (o `'aborted'`) con `resolved_by` igual a quien lo resolvió.

Esto mantiene la separación de responsabilidades: Amalia automatiza la parte mecánica (merge/cherry-pick) y la detección de conflictos, pero la resolución semántica de un conflicto de código siempre queda en manos de una persona.

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
4. **Publicación**: `POST /api/orchestrator/tasks` por cada tarea, con `assigned_to` y `depends_on` — la Capa 1 persiste en `amalia.db` y replica la tarea en el `TASKS.md` local del bee destino.
5. **Escucha**: se suscribe al WebSocket (`task:status_changed`, eventos de resultado) o hace polling de `GET /api/orchestrator/tasks?status=completed,failed`. Si la API no responde, puede leer directamente los `RESULTS.md` locales de cada worktree como respaldo.
6. **Decisión**: ante un resultado, crea nuevas tareas, desbloquea dependientes, o marca el trabajo global como terminado.

### Ciclo de vida de un Bee

1. **Arranque**: sesión CLI o lanzador API en `honeycomb/<nombre-bee>/`, según `bee.md`.
2. **Lectura de contrato**: lee `AGENTS.md` (rol/límites) y `bee.md` (su propia configuración de motor).
3. **Registro y heartbeat**: `POST /api/orchestrator/bees/register`, luego `PATCH /api/orchestrator/bees/:id/heartbeat` cada `heartbeat_segundos`.
4. **Reclamo de tarea**: lee su `TASKS.md` local primero (funciona incluso si la API está caída); si hay conexión, confirma el reclamo con `POST /api/orchestrator/tasks/:id/claim` (la Capa 1 ejecuta el `UPDATE` atómico descrito en Capa 0) y este responde escribiendo el `Lock` también en el archivo local. Si pierde la carrera (otra ejecución ya la tomó), pide la siguiente tarea `pending`.
5. **Ejecución**: usa sus propias herramientas (Read/Edit/Bash/etc.) para resolver la tarea dentro de su worktree.
6. **Reporte**: escribe primero en su `RESULTS.md` local, luego llama `POST /api/orchestrator/tasks/:id/results` con el outcome (`completed`/`failed`) y detalle; la Capa 1 actualiza `tasks.status` en la base y emite el evento. Si la API no responde, el resultado queda en el archivo local pendiente de sincronizar (ver "Modo degradado y reconciliación" en Capa 0).
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
- `POST /api/orchestrator/integrations` — iniciar una integración (`bee_id`, `commit` opcional) — ejecuta el merge/cherry-pick descrito en Capa 0
- `GET /api/orchestrator/integrations` — listar integraciones (filtro por estado, útil para ver conflictos pendientes)
- `PATCH /api/orchestrator/integrations/:id/resolve` — marcar una integración en conflicto como resuelta (`resolved_by`, `status` final)

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

## CLI de Amalia — Tareas que Amalia puede realizar

El binario `amalia` es el cliente principal del Orchestrator API. Se ejecuta normalmente desde el worktree `honeycomb/amalia/` (es la herramienta con la que el agente/orquestador "trabaja"), pero funciona desde cualquier punto dentro del repo gracias al marcador `.amalia-root`.

| Comando | Qué hace |
|---|---|
| `amalia init` | Bootstrap inicial: crea `honeycomb/`, el worktree `amalia/`, `orchestrator-api/` y `amalia.db` con el esquema aplicado. |
| `amalia start` | Levanta el Orchestrator API (Capa 1) como proceso de fondo (REST + WebSocket) sobre `amalia.db`. |
| `amalia stop` | Detiene el Orchestrator API. |
| `amalia hatch <nombre-bee> [--role "<resumen>"] [--engine claude-code\|opencode\|copilot-cli\|codex-cli\|ollama] [--branch <rama>]` | "Hace eclosionar" un bee nuevo: crea el `git worktree` en `honeycomb/<nombre-bee>/`, genera sus `AGENTS.md`, `bee.md`, `TASKS.md` y `RESULTS.md` a partir de templates, y lo registra en la tabla `bees`. |
| `amalia kill <nombre-bee>` | Elimina un bee: borra su `git worktree`, sus archivos locales y su registro en `bees` (acción destructiva, pide confirmación). |
| `amalia check [<nombre-bee>]` | Muestra el estado de un bee o de todos: `online/idle/busy/offline`, último heartbeat, tarea actual. Lee de `amalia.db` vía la API; si la API no responde, cae a leer los `TASKS.md`/`RESULTS.md` locales. |
| `amalia task add <nombre-bee> "<descripción>" [--priority high\|medium\|low] [--depends-on TASK-ID]` | Crea una tarea nueva asignada a un bee (lo que hace Amalia al descomponer un requerimiento). |
| `amalia task list [--status pending,in_progress,...] [--bee <nombre-bee>]` | Lista tareas con filtros. |
| `amalia task show <task-id>` | Detalle de una tarea: estado, lock, dependencias, resultado si existe. |
| `amalia logs <nombre-bee>` | Muestra el historial de `RESULTS.md`/eventos de un bee. |
| `amalia integrate <nombre-bee> [<commit>]` | Integra a la rama principal el trabajo de un bee (merge o cherry-pick). Si hay conflictos, los reporta en `integrations` y los deja para resolución humana — no intenta resolverlos. |
| `amalia integrate --resolve <integration-id>` | Marca una integración en conflicto como resuelta, después de que un humano corrigió el conflicto con Git manualmente. |
| `amalia sync` | Fuerza la reconciliación archivo↔DB descrita en la Capa 0 (útil tras un modo degradado). |
| `amalia doctor` | Valida el esquema de `amalia.db`, limpia locks expirados, detecta bees con heartbeat vencido y verifica consistencia entre archivos locales y la base. |

Estos comandos son la interfaz directa de los pasos 4 y 5 del **Ciclo de vida de Amalia** (publicación de tareas y escucha de resultados): en la práctica, la sesión de Amalia ejecuta `amalia hatch` y `amalia task add` para delegar trabajo, y `amalia check`/`amalia logs` para supervisarlo, en vez de llamar manualmente a la API REST.

## Capa 2 — Dashboard Web (Opcional)

Cliente que consume exclusivamente la API/WebSocket de la Capa 1:

- Tablero de bees activos, con su motor de IA visible (Claude Code, opencode, Ollama, etc.)
- Cola de tareas con filtros por estado/bee
- Vista de detalle de tarea + historial de reportes (tabla `results`)
- Capacidad de crear tareas manualmente desde la UI

Stack sugerido: HTML + JS vanilla o un framework ligero (Svelte/React), consumiendo el WebSocket para refresco en tiempo real.

## Roadmap de Fases

### Fase 1 — Modelo de Datos y Orchestrator API (Capas 0+1, base obligatoria)
- [ ] Esquema SQLite (`bees`, `tasks`, `task_dependencies`, `results`, `integrations`, `events`)
- [ ] Servicio Node.js/TypeScript con las rutas REST descritas
- [ ] Reclamo atómico de tareas (`/tasks/:id/claim`)
- [ ] Job de heartbeats vencidos y desbloqueo de dependencias
- [ ] Lógica de integración (`/integrations`) con detección de conflictos vía `git status`
- [ ] WebSocket (Socket.io) con los eventos descritos
- [ ] Replicación automática DB → `TASKS.md` y bee → `RESULTS.md` en cada worktree
- [ ] Job de reconciliación al reconectar (modo degradado)
- [ ] Templates de `AGENTS.md`, `bee.md`, `TASKS.md`, `RESULTS.md`
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

### Fase 4 — Empaquetado y CLI (distribución como npm)
- [ ] Paquete npm `amalia` con binario `amalia` (bin/)
- [ ] `amalia init` — bootstrap de `honeycomb/`, worktree `amalia/`, `orchestrator-api/`, `amalia.db`
- [ ] `amalia hatch` / `amalia kill` — alta y baja de bees (worktree + archivos + registro en DB)
- [ ] `amalia start` / `amalia stop` — control del Orchestrator API como proceso de fondo
- [ ] `amalia check` / `amalia task add` / `amalia task list` / `amalia task show` / `amalia logs`
- [ ] `amalia sync` / `amalia doctor` — reconciliación y diagnóstico
- [ ] Publicación del paquete en npm (versión inicial)

## Consideraciones Técnicas

- **Distribución**: Amalia es un paquete npm instalable en cualquier repositorio Git (`npm install -g amalia` + `amalia init`); no asume nada sobre el proyecto objetivo más allá de tener Git y Node.js disponibles.
- **Git Worktrees**: `amalia/` y cada `*-bee/` son worktrees reales (`git worktree add`) del repositorio original bajo `honeycomb/`.
- **Fuente de verdad principal + réplica resiliente**: la SQLite (`amalia.db`) es la fuente de verdad cuando está disponible, pero cada worktree mantiene su `TASKS.md`/`RESULTS.md` como réplica local — si la base o la API caen, la colmena sigue trabajando con archivos y reconcilia al volver la conexión (ver Capa 0).
- **Cola de mensajes embebida**: la tabla `tasks` + reclamo atómico (`UPDATE ... WHERE status='pending'`) cumple el rol de un broker tipo RabbitMQ sin añadir un segundo servicio de infraestructura.
- **Multi-motor**: cada worktree declara su motor en `bee.md`, separado del contrato de rol en `AGENTS.md`. Cambiar de motor no afecta el contrato de negocio.
- **Seguridad de credenciales**: ninguna API key se escribe en `bee.md` ni se versiona en Git; solo se referencian nombres de variables de entorno (`auth_env`).
- **Detección de bees caídos**: heartbeat vía WebSocket/REST comparado contra `heartbeat_segundos`; un bee caído libera automáticamente sus tareas `in_progress`.
- **Escalabilidad**: si en el futuro se necesita multi-host, la API es el único punto que tendría que migrar de SQLite a Postgres — el resto del sistema (bees, dashboard) no se entera, porque siempre habla con la API, nunca con la base directamente.
- **Separación de responsabilidades en la integración**: Amalia automatiza el merge/cherry-pick mecánico y la detección de conflictos; nunca intenta resolver un conflicto de código por sí misma — eso queda siempre como intervención humana vía Git.

## Tecnologías

| Componente | Tecnología |
|-----------|------------|
| Distribución / CLI | Paquete npm (`amalia`), binario en `bin/` |
| Orchestrator API (Capa 1) | Node.js + TypeScript |
| Base de datos / cola de mensajes (Capa 0) | SQLite (`better-sqlite3` o `node:sqlite`) |
| WebSocket | Socket.io |
| Dashboard (Capa 2) | HTML + JS vanilla / Svelte / React |
| Motores de Amalia/Bees (Capa 3) | Claude Code, opencode, Copilot CLI, Codex CLI, Ollama (modelos locales), u otros vía API |
| Control de versiones | Git con worktrees (`honeycomb/`) |

---

*Documento de especificación v7.0 — Amalia: roles y alcance explícitos (Amalia orquesta e integra, los bees ejecutan y nunca hacen merge a la rama principal), comando `amalia integrate` para fusionar el trabajo de un bee con detección de conflictos (resolución siempre humana vía Git), distribuible como paquete npm instalable en cualquier repositorio Git (`amalia init`), con CLI propio (`hatch`, `check`, `task add`, `integrate`, `sync`, `doctor`, etc.); SQLite como fuente de verdad principal y cola de mensajes embebida, con réplica resiliente en `TASKS.md`/`RESULTS.md` por worktree (modo degradado + reconciliación), separación `AGENTS.md` (contrato de rol) / `bee.md` (configuración de motor)*
