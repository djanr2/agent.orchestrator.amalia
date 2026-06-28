# Especificación de Arquitectura: Amalia — Orquestador Multi-Agente

> **Alcance de esta especificación: Fase 1.** Todo lo descrito en este documento (Capas 0-3, CLI, distribución npm, seguridad, etc.) corresponde a la **Fase 1** del proyecto Amalia. La Fase 2 se definirá en un documento separado una vez que la Fase 1 esté **terminada y probada** — no se anticipa ni se diseña aquí.

## Visión General

**Amalia** es un sistema que permite a **múltiples motores de IA** (Claude Code, opencode, GitHub Copilot CLI, OpenAI Codex CLI, modelos locales vía Ollama, etc.) coordinarse como un enjambre de trabajo, usando la metáfora de una colmena:

- **Amalia** — el orquestador principal. Analiza el requerimiento general sobre el **repositorio original**, lo descompone en tareas y supervisa el progreso del enjambre. Amalia es en sí misma un `git worktree`.
- **Bees** — los workers especializados. Cada uno tiene un rol independiente (ej. `database-bee`, `frontend-bee`, `infrastructure-bee`) y desarrolla su tarea en su propio worktree, sin pisar el trabajo de los demás.
- **Honeycomb** — el directorio raíz que contiene los worktrees: el de Amalia y el de cada bee. Es el panal donde vive el enjambre.

La comunicación primaria entre Amalia y los bees es vía una **base de datos SQLite** que actúa como cola de tareas y fuente de verdad única — Amalia escribe tareas en la base; cada bee las reclama y reporta resultados ahí mismo, todo a través de una API/WebSocket (Capa 1, **obligatoria**).

Pero **la estructura de archivos se mantiene como réplica local en cada worktree**, ahora organizada en una carpeta `tasks/` (en vez de dos archivos planos): cada tarea tiene su propio par de archivos `<slug>.task.md` / `<slug>.result.md`, y dos archivos resumen (`tasks.md`/`results.md`) que agregan todas las tareas del worktree en una vista corta — son los únicos que Amalia necesita leer. Esto da **resiliencia ante caída de la base de datos**: si `amalia.db` o el Orchestrator API se caen, cada bee ya tiene sus tareas escritas en su carpeta `tasks/` local y puede seguir trabajando de forma independiente, reportando ahí mismo. Cuando la base vuelve, se sincroniza (ver Capa 0 → "Modo degradado y reconciliación"). Cada worktree puede además estar potenciado por un motor de IA distinto, declarado en su propio `bee.md` (ver Capa 3), y este mismo `bee.md` declara la convención de trabajo de la carpeta `tasks/`.

## Roles y Alcance

### Amalia — Orquestador

**Rol**: coordinar el enjambre y mantener una **rama de integración siempre al día** con `main` (o la rama actual del repositorio padre), donde va preparando los commits de los bees antes de que lleguen a la rama principal. Amalia **nunca escribe código de la aplicación**; su trabajo es de gestión y de integración del trabajo ya hecho por los bees.

Alcance:
- Analizar el requerimiento general sobre el repositorio original y descomponerlo en tareas.
- Crear y eliminar bees (`amalia hatch` / `amalia kill`).
- Publicar tareas y resolver dependencias entre ellas (`amalia task add`, desbloqueo automático).
- Supervisar el progreso (`amalia check`, `amalia logs`).
- **Mantener su worktree actualizado respecto a `main`**: trae los cambios nuevos de la rama principal del repositorio padre a su propia rama de integración (`amalia update`, ver Capa 0).
- **Preparar e integrar en esa rama** los commits ya completados de cada bee (`amalia integrate`, ver más abajo) — es un compendio de los cambios de todos los bees, no código escrito por Amalia.
- Reaccionar ante fallos o bloqueos: reasignar, reabrir tareas, marcar inconsistencias para intervención humana.

Límites:
- NO escribe ni edita código de negocio directamente — eso es trabajo exclusivo de los bees, cada uno dentro de su `AGENTS.md`. El worktree de Amalia nunca tiene código propio: solo es el lugar donde se acumulan, en orden, los commits que los bees ya hicieron.
- NO repara inconsistencias de código ni resuelve conflictos de merge de Git — **los detecta y los marca como tales**; la reparación es responsabilidad de un humano (el programador).
- NO decide detalles de implementación dentro del dominio de un bee (cómo modelar una entidad, qué librería usar, etc.) — solo define **qué** se necesita, no **cómo**.

### Bee — Worker especializado

**Rol**: ejecutar tareas dentro de su área de responsabilidad, declarada en su propio `AGENTS.md`.

Alcance:
- Reclamar y ejecutar las tareas que Amalia le asigna, dentro de su propio worktree/rama.
- Hacer commits locales en la rama de su worktree a medida que avanza.
- Reportar resultados (`tasks/<slug>.result.md` + API) con suficiente detalle para que Amalia pueda integrar el trabajo sin tener que leer el código.

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
# con nombre/ruta de panal personalizada:
npx amalia init --honeycomb-path tools/swarm
```

- **`amalia init [--honeycomb-path <ruta>]`** — ejecutado en la raíz de un repositorio Git existente. Crea la carpeta del panal (`honeycomb/` por defecto, o la ruta indicada en `--honeycomb-path`), el worktree `<panal>/amalia/` (con sus `AGENTS.md`/`bee.md` por defecto), la carpeta `<panal>/orchestrator-api/` con `amalia.db` ya con el esquema de la Capa 0 aplicado, y el archivo `.amalia-root` en la raíz del repo.
- **`.amalia-root` no es solo un marcador vacío**: es un archivo de configuración (YAML/JSON) que registra la ruta real del panal, de modo que el nombre/ubicación se elige una sola vez en `init` y todos los comandos posteriores lo respetan sin necesidad de repetir el flag:
  ```yaml
  # .amalia-root
  honeycomb_path: tools/swarm
  ```
- A partir de ahí, **no se crean bees automáticamente** — Amalia (el orquestador) decide cuándo "hace eclosionar" (`hatch`) un nuevo bee según las tareas que identifique, vía el CLI (ver siguiente sección).
- El CLI detecta el panal buscando `.amalia-root` hacia arriba desde el directorio actual, lee la ruta real del panal desde ahí, así que los comandos funcionan tanto parado en la raíz del repo como dentro de `<panal>/amalia/` o de cualquier `*-bee/`, sin importar el nombre elegido.

### Amalia no forma parte del repositorio orquestado

Amalia es una herramienta de **apoyo** al desarrollo multiagente, no un componente del proyecto que orquesta: ningún archivo que genera (el panal completo, con todos los worktrees, `amalia.db`, tokens, etc.) debe quedar versionado en el historial del repositorio original.

Por eso, como parte del bootstrap, `amalia init`:
1. Crea (o actualiza, si ya existe) el `.gitignore` en la raíz del repo, agregando las entradas necesarias. Si se usó el nombre por defecto:
   ```gitignore
   # Amalia — generado automáticamente por `amalia init`, no editar a mano esta sección
   .amalia-root
   honeycomb/
   ```
   O, si se usó `--honeycomb-path tools/swarm`:
   ```gitignore
   # Amalia — generado automáticamente por `amalia init`, no editar a mano esta sección
   .amalia-root
   tools/swarm/
   ```
2. Si el repositorio ya tiene un `.gitignore`, Amalia **agrega** estas líneas (delimitadas con un comentario marcador) en vez de sobreescribir el archivo completo — y `amalia doctor` valida que esas líneas sigan presentes, por si alguien las borró por error.
3. Si por algún motivo `honeycomb/`/`<ruta-personalizada>` o `.amalia-root` ya estaban trackeados por Git **antes** de correr `amalia init` (un escenario inusual, p. ej. una instalación previa mal hecha), `amalia init` lo detecta y avisa explícitamente, en vez de dejarlos ignorados silenciosamente mientras siguen versionados.

### Precondiciones de instalación

Todo el sistema depende de `git worktree` (para `amalia/` y cada `*-bee/`) y de `amalia integrate` (para fusionar a la rama principal). Por eso `amalia init` valida el entorno **antes** de crear nada, y aborta con un mensaje claro si alguna condición no se cumple:

1. **Git instalado y accesible en el `PATH`** — se verifica ejecutando `git --version`. Sin esto no hay manera de crear los worktrees ni de integrar trabajo; es un requisito duro, no una advertencia.
2. **Versión de Git con soporte de `git worktree`** — el comando existe desde Git 2.5+; se valida la versión mínima para evitar fallos confusos más adelante al hacer `hatch`.
3. **El directorio actual es la raíz de un repositorio Git** (`git rev-parse --is-inside-work-tree`) — `amalia init` no se ejecuta sobre una carpeta cualquiera, sino sobre un repo ya inicializado (`git init` previo, a cargo del usuario).
4. **Node.js disponible** (ya implícito por ser un paquete npm) — se valida la versión mínima requerida por el Orchestrator API.

Si alguna validación falla, `amalia init` no crea `honeycomb/` ni archivos parciales — termina limpio con instrucciones de qué instalar (ej. "Git no encontrado: instala Git y vuelve a intentar"). Esta misma validación de Git la repite `amalia doctor` en cualquier momento posterior, por si el entorno cambió (ej. una reinstalación del sistema que quitó Git del `PATH`).

## Arquitectura por Capas

```
 Capa 2 — Dashboard Web (panal visual)                          [OBLIGATORIA]
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

Las cuatro capas son parte integral del proyecto Amalia — ninguna es opcional. El dashboard (Capa 2) no es un añadido cosmético: es la forma pensada para que un humano supervise y opere el enjambre de forma escalable a medida que crece el número de bees y tareas.

- **Capa 0 (Modelo de Datos)**: la base de datos SQLite es la fuente de verdad principal. Se eligió SQLite (y no Postgres/MySQL) porque se instala localmente sin depender de un servicio de base de datos externo — un solo archivo `.db` dentro del repositorio de Amalia. Cada worktree mantiene además una **réplica local en archivos**, organizada en una carpeta `tasks/`, de sus propias tareas, para poder seguir operando si la base no está disponible.
- **Capa 1 (Orchestrator API)**: servicio Node.js/TypeScript que es el único proceso con acceso de escritura directo a la SQLite; expone REST + WebSocket para que Amalia, los bees y el dashboard interactúen con la cola de tareas.
- **Capa 2 (Dashboard)**: cliente web que consume la Capa 1. Parte obligatoria del proyecto.
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

`honeycomb/` se crea dentro del repositorio Git objetivo al ejecutar `amalia init` (ver "Distribución e Instalación") — el nombre y la ruta son personalizables con `--honeycomb-path` y quedan registrados en `.amalia-root`; el resto de esta especificación usa `honeycomb/` como nombre por defecto, pero todo aplica igual a una ruta personalizada. El archivo `.amalia-root` vive en la raíz del repo, junto al panal, y **ambos quedan excluidos de Git** vía `.gitignore` (ver "Amalia no forma parte del repositorio orquestado"):

```
<raíz-del-repo>/
├── .gitignore                   # Amalia agrega aquí .amalia-root y la ruta del panal
├── .amalia-root                 # Config del CLI: ruta real del panal (no se versiona)
└── honeycomb/                   # (o la ruta indicada en --honeycomb-path; tampoco se versiona)
    ├── amalia/                      # Worktree del orquestador principal
    │   ├── AGENTS.md                  # Rol y alcance de Amalia
    │   ├── bee.md                     # Motor de IA de Amalia (mismo esquema que un bee)
    │   └── tasks/                     # Réplica local: tareas globales que Amalia ha publicado
    │       ├── tasks.md                 # Resumen general (lo único que Amalia necesita leer)
    │       └── results.md               # Resumen general de resultados recibidos
    ├── database-bee/                # Worktree: especialista en base de datos
    │   ├── AGENTS.md                  # Rol, alcance, límites (negocio)
    │   ├── bee.md                     # Motor de IA + conexión + convención de trabajo (técnico)
    │   └── tasks/                     # Una tarea = un par de archivos .task.md / .result.md
    │       ├── tasks.md                          # Resumen general de tareas (sincronizado con la DB)
    │       ├── results.md                        # Resumen general de resultados (sincronizado con la DB)
    │       ├── crear-tabla-events.task.md
    │       ├── crear-tabla-events.result.md
    │       ├── crear-tabla-bees.task.md
    │       ├── crear-tabla-bees.result.md
    │       ├── poblar-tabla-events.task.md
    │       ├── poblar-tabla-events.result.md
    │       ├── poblar-tabla-bees.task.md
    │       └── poblar-tabla-bees.result.md
    ├── backend-api-bee/              # Worktree: especialista en API REST
    │   ├── AGENTS.md
    │   ├── bee.md
    │   └── tasks/
    │       ├── tasks.md
    │       └── results.md
    ├── frontend-bee/                 # Worktree: especialista en frontend
    │   ├── AGENTS.md
    │   ├── bee.md
    │   └── tasks/
    │       ├── tasks.md
    │       └── results.md
    ├── infrastructure-bee/           # Worktree: DevOps/infra
    │   ├── AGENTS.md
    │   ├── bee.md
    │   └── tasks/
    │       ├── tasks.md
    │       └── results.md
    ├── orchestrator-api/             # Capa 1: servicio Node.js/TypeScript (obligatorio, no es worktree)
    │   ├── amalia.db                   # Base de datos SQLite (fuente de verdad principal)
    │   └── .secrets/                   # Tokens por bee (fuera de Git, ver Capa 1 → Seguridad)
    ├── dashboard/                    # Capa 2: cliente web (obligatorio, no es worktree)
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
-- Versión del esquema, para migraciones al subir de versión el paquete npm.
-- amalia init la inserta; amalia doctor compara contra la versión que trae el binario
-- y aplica migraciones incrementales si el amalia.db existente quedó atrás.
CREATE TABLE schema_version (
  version    INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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
  token_hash      TEXT NOT NULL,               -- hash (no el token) del bearer token del bee; ver Capa 1 → Seguridad
  heartbeat_seconds INTEGER NOT NULL DEFAULT 60,
  last_heartbeat_at TEXT,                      -- ISO timestamp
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cola de tareas (también cumple el rol de message queue)
CREATE TABLE tasks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT NOT NULL UNIQUE,         -- 'TASK-001'
  slug            TEXT NOT NULL,                -- nombre de archivo: 'crear-tabla-events'; único dentro del worktree destino
  assigned_to     INTEGER NOT NULL REFERENCES bees(id),
  created_by      INTEGER NOT NULL REFERENCES bees(id), -- normalmente 'amalia'
  status          TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'claimed'|'in_progress'|'completed'|'blocked'|'failed'
  priority        TEXT NOT NULL DEFAULT 'medium',  -- 'high'|'medium'|'low'
  description     TEXT NOT NULL,
  acceptance_criteria TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,      -- nº de veces que se reclamó/ejecutó
  max_attempts    INTEGER NOT NULL DEFAULT 3,      -- al agotarse -> 'blocked' para intervención
  rev             INTEGER NOT NULL DEFAULT 1,      -- contador monotónico; +1 en cada cambio. Árbitro de la reconciliación (no timestamps)
  locked_by       INTEGER REFERENCES bees(id),     -- bee que reclamó la tarea
  locked_by_instance TEXT,                         -- id de instancia del bee que tiene el lease (reemplaza al PID, válido entre hosts)
  lease_expires_at TEXT,                           -- vencimiento del lease; al pasar, la Capa 1 puede re-liberar la tarea
  claimed_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assigned_to, slug)
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
  attempt       INTEGER NOT NULL DEFAULT 1,  -- nº de intento al que corresponde este reporte
  idempotency_key TEXT NOT NULL,             -- clave que el bee genera por reporte; reintentos de red no duplican fila
  outcome       TEXT NOT NULL,               -- 'completed' | 'failed'
  files_changed TEXT,                        -- JSON: ["path1 (creado)", "path2 (modificado)"]
  decisions     TEXT,
  blockers      TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (task_id, idempotency_key)          -- un reintento con la misma clave es un no-op idempotente
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

-- Bitácora de eventos, también usada para reproducir el WebSocket tras una caída.
-- El `id` autoincremental es monotónico y actúa como cursor: cada cliente WS guarda el
-- último `id` que procesó y al reconectar pide GET /events?since=<id> para recuperar lo perdido
-- (semántica Last-Event-ID), antes de volver a escuchar en vivo.
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,                 -- 'task:created' | 'task:status_changed' | 'bee:registered' | 'bee:heartbeat' | 'integration:conflict' | 'integration:success'
  payload     TEXT NOT NULL,                 -- JSON
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

> **Nota sobre concurrencia de SQLite.** La base se abre en modo **WAL** (`PRAGMA journal_mode=WAL`) con `PRAGMA busy_timeout` configurado, para que las lecturas no bloqueen a la única escritura. El reclamo atómico (más abajo) y cualquier transacción de escritura usan `BEGIN IMMEDIATE` para tomar el lock de escritura desde el inicio y evitar carreras read-then-write.

### Modelo de trabajo: la cola de mensajes vive en SQLite

En vez de un broker externo (RabbitMQ u otro), la cola de mensajes **es la propia tabla `tasks`**, con reclamo atómico vía SQL y notificación en tiempo real vía WebSocket (Capa 1). Esto evita una segunda dependencia de infraestructura — coherente con la razón por la que se eligió SQLite sobre Postgres: cero servicios externos, todo corre embebido en un solo proceso Node.js.

**Reclamo atómico de una tarea** (lo ejecuta la Capa 1 a pedido del bee, nunca el bee directamente sobre el archivo `.db`):

```sql
UPDATE tasks
SET status = 'in_progress',
    locked_by = :bee_id,
    locked_by_instance = :instance_id,
    lease_expires_at = datetime('now', '+' || (:heartbeat_seconds * 3) || ' seconds'),
    attempts = attempts + 1,
    rev = rev + 1,
    claimed_at = datetime('now'),
    updated_at = datetime('now')
WHERE id = :task_id AND assigned_to = :bee_id AND status = 'pending';
-- Si changes() = 1 -> el bee obtuvo la tarea.
-- Si changes() = 0 -> otra ejecución ya la tomó (o ya no está pending); el bee debe pedir la siguiente.
```

Esta atomicidad (gracias a que SQLite serializa escrituras) es exactamente lo que da semántica de cola sin necesitar un broker dedicado: "como máximo un consumidor obtiene cada mensaje".

**Lease en vez de PID.** El reclamo fija un `lease_expires_at` en vez de confiar en un `locked_pid` (un PID solo tiene sentido en el mismo host y se recicla). El bee renueva el lease con cada heartbeat. El `locked_by_instance` identifica la instancia concreta del bee (no solo el nombre), de modo que si dos procesos del mismo bee corren a la vez, solo el dueño del lease vigente puede reportar; un reporte con un `instance_id` que ya no es dueño del lease se rechaza. Esto evita el **trabajo duplicado** cuando un bee lento pierde heartbeats y la Capa 1 re-libera la tarea: al volver, el bee original verá que ya no es dueño del lease y no pisará el resultado del nuevo dueño.

### Asignación de tareas: estática por defecto, pool opcional

Por defecto cada tarea nace con un `assigned_to` fijo (Amalia decide qué bee la hace al descomponer el requerimiento), así que la "cola" tiene como mucho a los **distintos procesos de un mismo bee** compitiendo por reclamarla — el reclamo atómico cubre justo ese caso. Esto **no** es balanceo de carga entre bees: un bee saturado no cede trabajo a otro automáticamente.

Para casos donde sí se quiere reparto dinámico, se admite un **pool por rol**: una tarea puede crearse con `assigned_to = NULL` y un `role` objetivo; cualquier bee de ese rol que esté `idle` puede reclamarla (el `UPDATE` atómico añade `WHERE assigned_to IS NULL AND :bee_role = role`). Amalia o el operador deciden por tarea si va asignada o al pool. `amalia kill` usa esta vía para devolver al pool las tareas `pending` de un bee que se da de baja.

### Ciclo de vida de una tarea

```
pending → (claim atómico) → in_progress → completed
                                       └─→ failed → (si attempts < max_attempts) → pending
                                                 └─→ (si attempts >= max_attempts) → blocked
pending/in_progress → blocked  (dependencias no resueltas o falladas, o reintentos agotados)
in_progress → pending  (lease vencido: bee caído, ver más abajo)
```

- Cuando todas las `task_dependencies` de una tarea `blocked` pasan a `completed`, la Capa 1 la mueve automáticamente a `pending` y emite `task:status_changed`.
- Cuando una tarea pasa a `completed` o `failed`, la Capa 1 inserta el evento correspondiente y lo emite por WebSocket; Amalia decide los próximos pasos.
- **Reintentos.** Un `failed` con `attempts < max_attempts` vuelve a `pending` para reintento automático; al agotar `max_attempts` queda en `blocked` y se emite un evento para que un humano/Amalia intervenga. El `attempts` lo incrementa el reclamo atómico, así que cuenta intentos reales, no reabrimientos manuales.
- **Propagación de fallo a dependientes.** Si una tarea termina en `failed`/`blocked` definitivo, sus dependientes **no** se desbloquean: la Capa 1 los marca `blocked` con motivo `upstream_failed` y emite `task:status_changed`, en vez de dejarlos esperando para siempre una dependencia que nunca se completará. Amalia decide si reabrir, reasignar o cancelar la cadena.
- **Sin ciclos de dependencias.** `POST /tasks` rechaza una tarea cuyo `depends_on` introduzca un ciclo en el grafo de `task_dependencies` (validación previa con recorrido del grafo), evitando deadlocks donde un conjunto de tareas se bloquea mutuamente para siempre.

### Heartbeats y recuperación de bees caídos

- Cada bee activo hace `PATCH /api/orchestrator/bees/:id/heartbeat` cada `heartbeat_seconds` (declarado en su `bee.md`). El heartbeat **lo emite un proceso/hilo independiente del trabajo**, no el motor de IA mientras "piensa" o edita: si dependiera del turno del modelo, una tarea larga dejaría de latir y se interpretaría como caída. El heartbeat además **renueva el lease** (`lease_expires_at`) de la tarea en curso.
- La Capa 1 corre un job periódico: si `now - last_heartbeat_at > heartbeat_seconds * 3` (equivalente a un lease vencido), marca el bee como `offline` y libera sus tareas `in_progress` (`status='pending'`, `locked_by=NULL`, `locked_by_instance=NULL`) para que otro proceso del mismo bee (al reiniciar) o el propio bee tras reconectar pueda reclamarlas de nuevo. Como el reclamo incrementa `attempts`, una tarea que repetidamente tumba a su bee acabará en `blocked` en vez de reintentar en bucle infinito.

### Réplica en archivos: la carpeta `tasks/`

La base de datos es la fuente de verdad, pero **cada worktree mantiene una copia local en archivos** de sus propios datos, organizada como una carpeta `tasks/` (no dos archivos planos): cada tarea recibe su propio par de archivos, nombrados con un slug descriptivo, más dos archivos resumen que agregan todas las tareas del worktree.

**`tasks/<slug>.task.md`** — especificación completa de una sola tarea. El propio bee puede modificarlo mientras trabaja (por ejemplo, para anotar progreso o sub-pasos), no es solo de lectura:

```markdown
---
# Frontmatter de formato estricto: lo lee la reconciliación. NO mezclar con la prosa de abajo.
id: TASK-001
slug: crear-tabla-events
estado: pending
asignado_a: database-bee
prioridad: high
depende_de: [TASK-000]
rev: 1                       # contador monotónico; árbitro de la reconciliación
lock: null                  # { instancia, lease_expires_at } cuando está reclamada
ultima_sync_db: 2026-06-27T10:00:00Z
---

# Tarea: crear-tabla-events

- **Descripción**: Crear entidad `ExperimentRun` con campos: id, nombre, fecha_inicio, estado, id_dataset (FK)
- **Criterios de aceptación**:
  - Entidad creada con anotaciones JPA correctas
  - Repositorio CRUD generado
  - Migración o ddl-auto actualizado

<!-- El agente puede anotar progreso libremente debajo de esta línea sin romper el parseo. -->
```

**`tasks/<slug>.result.md`** — reporte de esa misma tarea, escrito por el bee al completarla:

```markdown
# Resultado: crear-tabla-events

- **Tarea**: TASK-001
- **Estado**: ✅ Completado

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

**`tasks/tasks.md`** y **`tasks/results.md`** — los **resúmenes generales**, una línea o bloque corto por tarea, con referencia al archivo de detalle. Son los únicos archivos que Amalia lee por defecto; no necesita abrir cada `.task.md`/`.result.md` salvo que el resumen no sea suficiente:

```markdown
# tasks.md — database-bee (resumen general)

| ID | Archivo | Estado | Prioridad |
|---|---|---|---|
| TASK-001 | crear-tabla-events.task.md | pending | high |
| TASK-002 | crear-tabla-bees.task.md | in_progress | high |
```

```markdown
# results.md — database-bee (resumen general)

| ID | Archivo | Estado | Resumen |
|---|---|---|---|
| TASK-001 | crear-tabla-events.result.md | ✅ Completado | Entidad ExperimentRun creada con repositorio CRUD |
```

**Generación del slug (único por worktree).** El `slug` se deriva del nombre corto de la tarea, pero la Capa 1 garantiza unicidad dentro del worktree destino (constraint `UNIQUE (assigned_to, slug)`): si el slug base ya existe para ese bee, se le añade el `code` como sufijo (`crear-tabla-events` → `crear-tabla-events-task-014`). Así dos tareas de nombre parecido nunca se pisan el mismo par de archivos.

**Escritor único por archivo (evita la doble escritura).** Para no tener a la API y al bee escribiendo el mismo markdown a la vez, el dueño de cada archivo es exclusivo:
- `tasks/<slug>.task.md` y `tasks/<slug>.result.md` son propiedad del **bee asignado**: solo él los escribe (progreso, lock local, resultado). La Capa 1 **solo los crea la primera vez** (al publicarse la tarea) y luego no los vuelve a tocar; las actualizaciones de estado que origina la API (p. ej. desbloqueo por dependencias) viajan al bee vía WebSocket y es el bee quien las plasma en su archivo.
- Los resúmenes `tasks/tasks.md`/`tasks/results.md` también los escribe **solo el bee** de ese worktree. Amalia y el dashboard los **leen**, nunca los escriben.
- Excepción controlada: la **reconciliación** (ver abajo) puede escribir un `tasks/<slug>.task.md` nuevo en un worktree, pero solo para tareas que el bee aún no tenía y solo mientras el bee no esté activo sobre ese archivo (se hace por `amalia sync`/al reconectar, no en caliente).

Reglas de sincronización:
- Cuando Amalia publica una tarea (`POST /tasks`), la Capa 1 la inserta en `amalia.db` **y** crea por única vez `tasks/<slug>.task.md` en el worktree destino, además de agregar la fila correspondiente en `tasks/tasks.md`.
- Cuando un bee reclama (`/claim`) o avanza una tarea, actualiza primero su `tasks/<slug>.task.md` local (y la fila en `tasks/tasks.md`), luego llama a la API para persistir en `amalia.db`.
- Cuando un bee reporta un resultado (`/results`), **primero escribe `tasks/<slug>.result.md`**, agrega/actualiza la fila en `tasks/results.md`, y luego llama a la API. Si la llamada a la API falla, el bee sigue operando solo con los archivos locales — quedan con el campo `rev` local por delante del de la base, marcando que hay cambios pendientes de subir.
- Esta separación (un par de archivos por tarea + un resumen agregado) evita que `tasks.md`/`results.md` se saturen de información cuando un bee tiene muchas tareas en paralelo o histórico.

> **El bloque de metadatos es de formato estricto.** Como un motor de IA edita libremente la prosa del `.task.md` para anotar progreso, los campos que la reconciliación necesita leer (`ID`, `Estado`, `rev`, `Lock`) viven en un **frontmatter YAML delimitado** al inicio del archivo, no mezclados en el cuerpo. El agente puede escribir lo que quiera **debajo** del frontmatter sin romper el parseo. Si el frontmatter se corrompe, `amalia doctor` lo detecta al verificar consistencia archivo↔DB y reconstruye el bloque desde la base.

### Modo degradado y reconciliación

Si `amalia.db` o el Orchestrator API caen, toda la colmena entra en **modo degradado**, pero no se detiene:

1. Cada bee ya tiene su(s) tarea(s) asignada(s) como archivos `tasks/<slug>.task.md` locales — puede seguir reclamando (marcando `Lock` localmente), ejecutando y reportando en su `tasks/<slug>.result.md` local sin depender de la base, y actualizando sus resúmenes `tasks/tasks.md`/`tasks/results.md`.
2. Amalia, si también pierde la API, puede seguir leyendo los `tasks/results.md` (resumen) de cada worktree directamente (son archivos en el mismo filesystem/worktrees) para decidir próximos pasos, y entrar al `.result.md` de detalle si necesita más contexto.
3. Al recuperarse el Orchestrator API, corre una **reconciliación** que **compara el `rev` (contador monotónico), no timestamps** — los relojes de los distintos worktrees pueden diferir y `datetime('now')` vs. la marca del archivo no son comparables de forma fiable. Por cada tarea, gana el lado con el `rev` más alto:
   - Si el `rev` del archivo local supera al de la base (la tarea avanzó de estado o se generó un resultado mientras la DB estaba caída), la Capa 1 aplica el archivo a la base (`INSERT`/`UPDATE`), iguala el `rev` y emite los eventos correspondientes.
   - Si el `rev` de la base supera al del archivo (p. ej. Amalia/dashboard cambió el estado vía API mientras el worktree estaba aislado), la Capa 1 reescribe el frontmatter del archivo local desde la base.
   - Si la base tiene tareas nuevas creadas por Amalia que el worktree no recibió, la Capa 1 las escribe ahora como nuevo `tasks/<slug>.task.md` en ese bee, y agrega la fila en `tasks/tasks.md`.
4. **Sobre los escritores concurrentes.** No es del todo cierto que "solo el bee asignado toca una tarea": el dashboard (`PATCH /tasks/:id/status`), el desbloqueo automático por dependencias y un eventual reasignado por Amalia también la modifican. Por eso la reconciliación **no asume un único escritor** y resuelve por `rev`. Aun así, los casos verdaderamente concurrentes se acotan por diseño:
   - El **cuerpo de trabajo** (avance, resultado) lo escribe solo el bee asignado → ahí no hay fusión de contenido, solo "quién va más adelantado".
   - Los **cambios administrativos** de estado (cancelar, reabrir, reasignar) los hace la API y **suben el `rev`**, de modo que ganan sobre una réplica local desactualizada y se propagan al archivo en la reconciliación.
   - Un cambio administrativo que colisione con avance local real del bee (ambos lados tocaron la misma tarea durante el aislamiento) se marca como **`reconcile:conflict`** en `events` para que Amalia/un humano lo revise, en lugar de descartar silenciosamente un lado.

### Mantener la rama de integración al día (`amalia update`)

El worktree de Amalia vive sobre una **rama de integración** (puede ser la propia `main`/rama actual del repo padre, o una rama dedicada tipo `amalia/integration` si se prefiere no tocar `main` hasta el `git push` final — la especificación no impone cuál, pero sí que sea **una sola** y que Amalia la mantenga siempre al día). El trabajo de Amalia no es solo recibir commits de los bees: también debe traer lo nuevo que entra a `main` desde fuera del enjambre (otros desarrolladores, otra integración ya empujada).

`amalia update`:
1. `git fetch` sobre el remoto del repositorio padre.
2. `git merge --ff-only origin/main` (o la rama actual configurada) sobre la rama de integración. Si no es fast-forward (alguien movió `main` con commits que no son ancestros directos), Amalia **no fuerza un merge automático**: lo marca como una inconsistencia (`integrations` con un `status` dedicado, o un evento `update:conflict`) para que el humano decida cómo traer esos cambios.
3. Este paso se ejecuta antes de cada `amalia integrate` (para integrar siempre sobre la base más reciente) y también puede dispararse manualmente o en el job de mantenimiento periódico de la Capa 1.

Esto es consistente con el límite de Amalia: **no repara inconsistencias de código** — si actualizar la rama de integración no es trivial (conflicto con `main`), lo señala y se detiene, en vez de intentar resolverlo por su cuenta.

### Integración a la rama principal (`amalia integrate`)

Los bees nunca hacen merge de su propio trabajo: solo Amalia integra, usando comandos de Git estándar (`git merge`/`git cherry-pick`) desde su propio worktree (`honeycomb/amalia/`), que apunta a la rama principal del repositorio original. El resultado de `amalia integrate` repetido sobre cada bee es, en esencia, un **compendio ordenado** de los cambios de todos los bees sobre la rama de integración — Amalia no agrega código propio en ningún punto de este proceso.

**Precondiciones e invariantes (la integración es serial).** El worktree de Amalia tiene **un solo árbol de trabajo** sobre la rama principal, así que las integraciones **no pueden solaparse**:
- Antes de empezar, la Capa 1 verifica que el worktree de Amalia tenga el **working tree limpio** (`git status --porcelain` vacío). Si hay un conflicto previo sin resolver (o cualquier cambio sin commitear), `amalia integrate` se rehúsa con un mensaje claro en vez de lanzar un `git merge` que fallaría de forma confusa.
- La Capa 1 toma un **lock de integración** (a lo sumo una integración `pending`/`conflict` a la vez). Un segundo `integrate` mientras hay uno en curso o un conflicto abierto se rechaza, no se encola ciegamente.
- Mientras una integración deja el árbol en conflicto, **toda la cola de integración queda en pausa** hasta que un humano resuelva o aborte: es intencional, pero conviene saber que es un punto de serialización.

**`amalia integrate <nombre-bee> [<commit>]`**:
1. Crea una fila en `integrations` con `status='pending'` (tras pasar las precondiciones anteriores).
2. Si se da `<commit>`, Amalia ejecuta `git cherry-pick <commit>` sobre la rama principal; si no se da, integra el último commit (o todos los commits nuevos) de la rama del worktree del bee con `git merge --no-ff <rama-del-bee>`.
3. **Si no hay conflictos**: el merge/cherry-pick se completa, `integrations.status` pasa a `success`, se emite `integration:success`. El commit queda en la rama principal del worktree de Amalia, listo para que un humano decida cuándo hacer `git push`.
4. **Si hay conflictos**: Git deja el merge a medias (working tree con marcadores `<<<<<<<`). Amalia detecta esto (`git status` reporta `UU`/conflicto), **no intenta resolverlo**, y:
   - Guarda en `integrations` el `status='conflict'` junto con la lista de `conflicting_files`.
   - Emite el evento `integration:conflict` (vía WebSocket y bitácora `events`) para que quede visible en `amalia check`/el dashboard.
   - Deja el repositorio en ese estado de conflicto intencionalmente — la resolución es trabajo humano con las herramientas de Git que prefiera (`git mergetool`, edición manual, etc.).
5. Un humano resuelve el conflicto, hace `git add`/`git commit` (o `git merge --abort` si decide descartar la integración) y corre `amalia integrate --resolve <integration-id>` para que Amalia marque `integrations.status='success'` (o `'aborted'`) con `resolved_by` igual a quien lo resolvió.

Esto mantiene la separación de responsabilidades: Amalia automatiza la parte mecánica (merge/cherry-pick) y la detección de conflictos, pero la resolución semántica de un conflicto de código siempre queda en manos de una persona.

**Integración incremental.** Un bee puede seguir commiteando después de una primera integración. Cada `amalia integrate` posterior hace `git merge --no-ff` de los **commits nuevos** de la rama del bee (Git ya sabe el punto de fusión anterior), así que integrar es repetible y no re-aplica lo ya integrado.

### Baja segura de un bee (`amalia kill`)

`amalia kill` es destructivo: elimina el `git worktree`, la carpeta `tasks/`, el token y el registro en `bees`. Para no perder trabajo:
- **Rehúsa por defecto si la rama del bee tiene commits sin integrar** a la rama principal (`git cherry main <rama-del-bee>` no vacío) o tareas `in_progress`/`pending`. Lista qué quedaría sin integrar y pide `--force` explícito para proceder de todos modos.
- Antes de borrar, ofrece reasignar las tareas `pending` del bee a otro bee del mismo rol (o devolverlas al pool, ver "Asignación de tareas").
- El borrado del worktree usa `git worktree remove` (no `rm -rf`), de modo que Git valide que no haya cambios sin guardar, salvo `--force`.

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

## Convención de Trabajo
- Cada tarea asignada vive como un par de archivos en `tasks/`: `<slug>.task.md` (especificación, editable por el propio agente mientras trabaja) y `<slug>.result.md` (reporte al completarla).
- El `<slug>` se deriva del nombre corto de la tarea (ej. `crear-tabla-events`), no del ID numérico.
- Al terminar (o avanzar significativamente) una tarea, el agente DEBE actualizar también los resúmenes generales `tasks/tasks.md` y `tasks/results.md` — son los únicos archivos que Amalia lee por defecto.
- Después de actualizar los archivos locales, sincronizar con el Orchestrator API (`/claim`, `/results`) salvo que esté en modo degradado (ver Capa 0).
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
4. **Publicación**: `POST /api/orchestrator/tasks` por cada tarea, con `assigned_to` y `depends_on` — la Capa 1 persiste en `amalia.db`, crea `tasks/<slug>.task.md` en el worktree destino y agrega la fila en su `tasks/tasks.md`.
5. **Escucha**: se suscribe al WebSocket (`task:status_changed`, eventos de resultado) o hace polling de `GET /api/orchestrator/tasks?status=completed,failed`. Si la API no responde, puede leer directamente los `tasks/results.md` (resumen) de cada worktree como respaldo.
6. **Decisión**: ante un resultado, crea nuevas tareas, desbloquea dependientes, o marca el trabajo global como terminado.
7. **Mantenimiento de la rama de integración**: corre `amalia update` para traer lo nuevo de `main`, y `amalia integrate <bee>` por cada bee con trabajo completado, dejando todo listo (o marcado en conflicto) para el `git push` que decida un humano.

### Ciclo de vida de un Bee

1. **Arranque**: sesión CLI o lanzador API en `honeycomb/<nombre-bee>/`, según `bee.md`.
2. **Lectura de contrato**: lee `AGENTS.md` (rol/límites) y `bee.md` (su propia configuración de motor).
3. **Registro y heartbeat**: `POST /api/orchestrator/bees/register`, luego `PATCH /api/orchestrator/bees/:id/heartbeat` cada `heartbeat_segundos`.
4. **Reclamo de tarea**: lee su `tasks/tasks.md` (resumen) local primero (funciona incluso si la API está caída) para ver qué tiene `pending`, y abre el `tasks/<slug>.task.md` correspondiente; si hay conexión, confirma el reclamo con `POST /api/orchestrator/tasks/:id/claim` (la Capa 1 ejecuta el `UPDATE` atómico descrito en Capa 0) y este responde escribiendo el `Lock` también en el archivo local. Si pierde la carrera (otra ejecución ya la tomó), pide la siguiente tarea `pending`.
5. **Ejecución**: usa sus propias herramientas (Read/Edit/Bash/etc.) para resolver la tarea dentro de su worktree, pudiendo anotar progreso directamente en su `tasks/<slug>.task.md`.
6. **Reporte**: escribe primero `tasks/<slug>.result.md`, actualiza la fila en `tasks/results.md` (y en `tasks/tasks.md` el nuevo estado), luego llama `POST /api/orchestrator/tasks/:id/results` con el outcome (`completed`/`failed`) y detalle; la Capa 1 actualiza `tasks.status` en la base y emite el evento. Si la API no responde, el resultado queda en los archivos locales pendiente de sincronizar (ver "Modo degradado y reconciliación" en Capa 0).
7. **Repetición o cierre**: vuelve a pedir trabajo, o termina la sesión si no hay tareas pendientes — decisión operativa, no estructural.

## Capa 1 — Orchestrator API (Node.js / TypeScript) — Obligatoria

Es el **único** proceso con acceso de escritura a `amalia.db`. Todo el resto del sistema (Amalia, bees, dashboard) habla con esta API — nunca con la base de datos directamente.

### API REST

Todas las rutas exigen `Authorization: Bearer <token>` (ver "Seguridad" más abajo); la API deriva la identidad del token, no del body.

- `POST /api/orchestrator/bees/register` — registrar/actualizar un bee (nombre, worktree, motor, modelo, modo de conexión)
- `GET /api/orchestrator/events?since=<id>` — reproducir eventos perdidos tras una reconexión WS (cursor `Last-Event-ID`)
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
- Eventos: `task:created`, `task:status_changed`, `bee:registered`, `bee:heartbeat`, `bee:offline`, `integration:success`, `integration:conflict`, `reconcile:conflict`
- Cada evento lleva el `id` de la fila en `events`; el cliente lo guarda como cursor y, al reconectar, pide `GET /events?since=<id>` para no perderse nada (ver tabla `events` en Capa 0).
- Es la forma recomendada en que Amalia y los bees se enteran de cambios sin hacer polling constante; el polling vía REST queda como respaldo si el cliente no mantiene conexión WS.

### Job de mantenimiento interno
- Cada `N` segundos: revisa bees con heartbeat vencido → los marca `offline` y libera sus tareas `in_progress`.
- Cada vez que una tarea pasa a `completed`: revisa `task_dependencies` y desbloquea las tareas `blocked` que ya cumplen todas sus dependencias.

### Seguridad

Aunque la API corra en `localhost`, **cualquier proceso o usuario de la máquina puede alcanzarla**, y algunos endpoints disparan acciones sensibles (`POST /integrations` ejecuta `git merge`/`cherry-pick`). Por eso:

- **Autenticación por token de bee.** `amalia hatch` (o el primer `register`) emite un token aleatorio por bee; la base guarda solo su **hash** (`bees.token_hash`), nunca el token en claro. El token se entrega al bee vía un archivo de permisos restringidos en `orchestrator-api/.secrets/<bee>.token` (fuera de Git) o una variable de entorno, y el bee lo manda como `Authorization: Bearer <token>` en cada llamada.
- **El `bee_id` se deriva del token, no del body.** La API ignora cualquier `bee_id`/`bee_name` que el cliente afirme y usa el del token autenticado. Esto impide que un bee **reclame o reporte en nombre de otro**. El `/claim` y `/results` solo proceden si el token corresponde al `assigned_to`/`locked_by` de la tarea.
- **Endpoints administrativos separados.** `PATCH /tasks/:id/status`, `POST /integrations`, `kill` y demás operaciones de orquestación exigen el **token de Amalia** (rol orquestador), no el de un bee cualquiera. El dashboard usa este mismo token de operador.
- **El servidor escucha solo en `127.0.0.1`** por defecto (no `0.0.0.0`); exponerlo a la red es una decisión explícita de configuración, no el default.
- **Validación y saneo de toda entrada** (defensa contra inyección y path traversal):
  - `nombre-bee` debe cumplir `^[a-z][a-z0-9-]*-bee$`; Amalia y otros nombres reservados, una whitelist conocida.
  - `slug` debe cumplir `^[a-z0-9][a-z0-9-]*$` y nunca contener `/`, `\` ni `..` — se usa para construir rutas de archivo.
  - `commit` debe ser un SHA válido (`^[0-9a-f]{7,40}$`) o un nombre de rama validado; nunca se interpola en una shell.
  - Toda invocación de Git se hace con **argumentos en array** (`execFile`/`spawn`, no `exec` con string), de modo que ningún valor controlado por el usuario llegue a un intérprete de shell.
  - Las rutas finales se resuelven y se verifica que queden **dentro de `honeycomb/`** antes de leer/escribir (anti path-traversal).
- **Aislamiento de secretos entre motores.** Cuando el lanzador arranca el subproceso de un bee, le pasa **solo** la variable declarada en su `auth_env` (y las imprescindibles), no todo el entorno del proceso padre — así un bee no puede leer las API keys de otro.
- **Rate limiting básico** en `register`/`heartbeat`/`claim` para que un cliente defectuoso no sature la única escritura de SQLite.

### Stack
- Node.js + TypeScript
- Socket.io para tiempo real
- SQLite (`better-sqlite3` o `node:sqlite`) — única opción, sin alternativa Postgres (decisión fija: cero servicios externos)

## CLI de Amalia — Tareas que Amalia puede realizar

El binario `amalia` es el cliente principal del Orchestrator API. Se ejecuta normalmente desde el worktree `honeycomb/amalia/` (es la herramienta con la que el agente/orquestador "trabaja"), pero funciona desde cualquier punto dentro del repo gracias al marcador `.amalia-root`.

| Comando | Qué hace |
|---|---|
| `amalia init [--honeycomb-path <ruta>]` | Valida precondiciones (Git instalado y con soporte de `worktree`, directorio es un repo Git, Node.js compatible) y, si todas pasan, hace el bootstrap: crea el panal (`honeycomb/` por defecto, o `<ruta>` si se indica), el worktree `amalia/`, `orchestrator-api/` y `amalia.db` con el esquema aplicado; escribe la ruta elegida en `.amalia-root`; agrega `.amalia-root` y la ruta del panal al `.gitignore` del repo. |
| `amalia start` | Levanta el Orchestrator API (Capa 1) como proceso de fondo (REST + WebSocket) sobre `amalia.db`. |
| `amalia stop` | Detiene el Orchestrator API. |
| `amalia hatch <nombre-bee> [--role "<resumen>"] [--engine claude-code\|opencode\|copilot-cli\|codex-cli\|ollama] [--branch <rama>]` | "Hace eclosionar" un bee nuevo: valida que `<nombre-bee>` cumpla `^[a-z][a-z0-9-]*-bee$` (ver Capa 1 → Seguridad), crea el `git worktree` en `honeycomb/<nombre-bee>/`, genera sus `AGENTS.md`, `bee.md` y la carpeta `tasks/` (con `tasks.md` y `results.md`) a partir de templates, emite un token de bee en `orchestrator-api/.secrets/` y lo registra en la tabla `bees`. |
| `amalia kill <nombre-bee>` | Elimina un bee: borra su `git worktree`, sus archivos locales, su token y su registro en `bees` (acción destructiva, pide confirmación). **Rehúsa si la rama del bee tiene commits sin integrar**, salvo `--force` (ver Capa 0 → "Baja segura de un bee"). |
| `amalia check [<nombre-bee>]` | Muestra el estado de un bee o de todos: `online/idle/busy/offline`, último heartbeat, tarea actual. Lee de `amalia.db` vía la API; si la API no responde, cae a leer los `tasks/tasks.md`/`tasks/results.md` locales. |
| `amalia task add <nombre-bee> "<descripción>" [--priority high\|medium\|low] [--depends-on TASK-ID]` | Crea una tarea nueva asignada a un bee (lo que hace Amalia al descomponer un requerimiento). |
| `amalia task list [--status pending,in_progress,...] [--bee <nombre-bee>]` | Lista tareas con filtros. |
| `amalia task show <task-id>` | Detalle de una tarea: estado, lock, dependencias, resultado si existe. |
| `amalia logs <nombre-bee>` | Muestra el historial de `tasks/results.md`/eventos de un bee. |
| `amalia update` | Trae a la rama de integración de Amalia lo nuevo de `main` (`git fetch` + `git merge --ff-only`). Si no es fast-forward, lo marca como inconsistencia para revisión humana — no fuerza un merge. |
| `amalia integrate <nombre-bee> [<commit>]` | Integra a la rama de integración el trabajo de un bee (merge o cherry-pick) — Amalia solo arma el compendio de commits, nunca escribe ni repara código. Si hay conflictos, los reporta en `integrations` y los deja para resolución humana — no intenta resolverlos. |
| `amalia integrate --resolve <integration-id>` | Marca una integración en conflicto como resuelta, después de que un humano corrigió el conflicto con Git manualmente. |
| `amalia sync` | Fuerza la reconciliación archivo↔DB descrita en la Capa 0 (útil tras un modo degradado). |
| `amalia doctor` | Revalida las precondiciones del entorno (Git instalado/con `worktree`), compara `schema_version` con la del binario y **aplica migraciones incrementales** si el `amalia.db` quedó atrás tras actualizar el paquete, limpia leases vencidos, detecta bees con heartbeat vencido y verifica consistencia entre archivos locales y la base (incluido el frontmatter de cada `tasks/<slug>.task.md`). |

Estos comandos son la interfaz directa de los pasos 4 y 5 del **Ciclo de vida de Amalia** (publicación de tareas y escucha de resultados): en la práctica, la sesión de Amalia ejecuta `amalia hatch` y `amalia task add` para delegar trabajo, y `amalia check`/`amalia logs` para supervisarlo, en vez de llamar manualmente a la API REST.

## Capa 2 — Dashboard Web (Obligatoria)

Parte integral del proyecto Amalia, no un añadido opcional — pensada para que la operación del enjambre sea escalable a medida que crecen los bees y las tareas. Cliente que consume exclusivamente la API/WebSocket de la Capa 1:

- Tablero de bees activos, con su motor de IA visible (Claude Code, opencode, Ollama, etc.)
- Cola de tareas con filtros por estado/bee
- Vista de detalle de tarea + historial de reportes (tabla `results`)
- Capacidad de crear tareas manualmente desde la UI

Stack sugerido: HTML + JS vanilla o un framework ligero (Svelte/React), consumiendo el WebSocket para refresco en tiempo real.

## Roadmap de Fases

### Fase 1 — Modelo de Datos y Orchestrator API (Capas 0+1, base obligatoria)
- [ ] Esquema SQLite (`schema_version`, `bees`, `tasks`, `task_dependencies`, `results`, `integrations`, `events`) con `rev`, `attempts`, lease y `token_hash`
- [ ] WAL + `busy_timeout` + `BEGIN IMMEDIATE` en las escrituras
- [ ] Servicio Node.js/TypeScript con las rutas REST descritas
- [ ] **Seguridad**: tokens por bee (hash en DB), identidad derivada del token, endpoints administrativos con token de Amalia, escucha en `127.0.0.1`, validación de nombres/slugs/commits y Git sin shell
- [ ] Reclamo atómico de tareas con lease (`/tasks/:id/claim`) e incremento de `attempts`
- [ ] Job de heartbeats/leases vencidos, desbloqueo de dependencias, reintentos (`max_attempts`) y propagación de fallo a dependientes (`upstream_failed`)
- [ ] Validación de ciclos de dependencia en `POST /tasks`
- [ ] Lógica de integración (`/integrations`) serial, con precondición de árbol limpio, lock de integración y detección de conflictos vía `git status`
- [ ] WebSocket (Socket.io) con los eventos descritos + `GET /events?since=<id>` (replay por cursor)
- [ ] Replicación automática DB → `tasks/<slug>.task.md` (frontmatter estricto) y bee → `tasks/<slug>.result.md` + resúmenes `tasks.md`/`results.md`, con regla de escritor único por archivo
- [ ] Job de reconciliación por `rev` al reconectar (modo degradado), con `reconcile:conflict`
- [ ] Migraciones de esquema dirigidas por `schema_version` (en `amalia doctor`)
- [ ] Templates de `AGENTS.md`, `bee.md` (incluyendo `## Convención de Trabajo`), y de la carpeta `tasks/`
- [ ] Convención de nomenclatura `<área>-bee` y generación de slugs únicos por worktree

### Fase 2 — Integración con motores (Capa 3)
- [ ] Cliente/skill para Claude Code que se registra, hace heartbeat, reclama tareas y reporta vía API
- [ ] Mismo cliente para opencode, Copilot CLI y Codex CLI
- [ ] Lanzador genérico para motores en `modo_conexion: api` (Ollama y otros)

### Fase 3 — Dashboard web (Capa 2, obligatoria)
- [ ] Tablero de bees activos (con motor visible)
- [ ] Cola de tareas con filtros por estado/bee
- [ ] Vista de detalle de tarea + historial de reportes
- [ ] Creación manual de tareas desde la UI

### Fase 4 — Empaquetado y CLI (distribución como npm)
- [ ] Paquete npm `amalia` con binario `amalia` (bin/)
- [ ] Validación de precondiciones (Git instalado, soporte `git worktree`, repo Git válido, versión de Node) antes de `init`
- [ ] `amalia init [--honeycomb-path]` — bootstrap del panal (nombre/ruta configurable), worktree `amalia/`, `orchestrator-api/`, `amalia.db`, config en `.amalia-root`
- [ ] Generación/actualización automática de `.gitignore` en `init` (excluir `.amalia-root` y la ruta del panal) + verificación en `doctor`
- [ ] `amalia hatch` / `amalia kill` — alta y baja de bees (worktree + archivos + registro en DB)
- [ ] `amalia start` / `amalia stop` — control del Orchestrator API como proceso de fondo
- [ ] `amalia update` / `amalia integrate` — mantener la rama de integración al día y compendiar commits de bees
- [ ] `amalia check` / `amalia task add` / `amalia task list` / `amalia task show` / `amalia logs`
- [ ] `amalia sync` / `amalia doctor` — reconciliación y diagnóstico
- [ ] Publicación del paquete en npm (versión inicial)

## Consideraciones Técnicas

- **Distribución**: Amalia es un paquete npm instalable en cualquier repositorio Git (`npm install -g amalia` + `amalia init`); no asume nada sobre el proyecto objetivo más allá de tener Git y Node.js disponibles.
- **Git Worktrees**: `amalia/` y cada `*-bee/` son worktrees reales (`git worktree add`) del repositorio original bajo `honeycomb/`.
- **Fuente de verdad principal + réplica resiliente**: la SQLite (`amalia.db`) es la fuente de verdad cuando está disponible, pero cada worktree mantiene su carpeta `tasks/` (un `.task.md`/`.result.md` por tarea + resúmenes `tasks.md`/`results.md`) como réplica local — si la base o la API caen, la colmena sigue trabajando con archivos y reconcilia al volver la conexión (ver Capa 0).
- **Escalabilidad de archivos por tarea**: separar cada tarea en su propio par de archivos (en vez de un único archivo plano con todo) evita que esos archivos se saturen cuando un bee acumula muchas tareas; los resúmenes (`tasks/tasks.md`/`tasks/results.md`) mantienen la vista rápida que Amalia necesita sin tener que abrir cada archivo de detalle.
- **Dashboard obligatorio**: la Capa 2 es parte integral del proyecto, no un complemento — es la herramienta de supervisión pensada para escalar junto con el número de bees y tareas.
- **Cola de mensajes embebida**: la tabla `tasks` + reclamo atómico (`UPDATE ... WHERE status='pending'`) cumple el rol de un broker tipo RabbitMQ sin añadir un segundo servicio de infraestructura.
- **Multi-motor**: cada worktree declara su motor en `bee.md`, separado del contrato de rol en `AGENTS.md`. Cambiar de motor no afecta el contrato de negocio.
- **Seguridad de credenciales**: ninguna API key se escribe en `bee.md` ni se versiona en Git; solo se referencian nombres de variables de entorno (`auth_env`).
- **Detección de bees caídos**: heartbeat (emitido por un hilo/proceso independiente del trabajo) que renueva un **lease**; si el lease vence (`heartbeat_segundos * 3`), el bee se marca `offline` y sus tareas `in_progress` se liberan. El `attempts` evita reintentos en bucle infinito sobre una tarea que tumba a su bee.
- **Escalabilidad**: el diseño actual es **single-host** por construcción (réplica de archivos en el filesystem local, la API escribiendo en los worktrees, y los `git worktree` viviendo todos en la misma máquina). Migrar a multi-host es bastante más que cambiar SQLite por Postgres: habría que resolver el acceso compartido a los worktrees (o repensar la réplica de archivos) y la ejecución remota de Git. La abstracción "todo el mundo habla con la API, nunca con la base" reduce el acoplamiento al motor de BD, pero **no** vuelve el sistema multi-host por sí sola.
- **Seguridad de la API**: autenticación por token de bee (la identidad se deriva del token, no del body), endpoints administrativos restringidos al token de Amalia, escucha solo en `127.0.0.1`, validación/saneo de nombres, slugs y commits, y ejecución de Git con argumentos en array (sin shell). Ver Capa 1 → "Seguridad".
- **Separación de responsabilidades en la integración**: Amalia automatiza el merge/cherry-pick mecánico y la detección de conflictos; nunca intenta resolver un conflicto de código por sí misma — eso queda siempre como intervención humana vía Git.
- **Amalia no es parte del repositorio orquestado**: todo lo que genera (panal, worktrees, `amalia.db`, tokens) se excluye del control de versiones del proyecto vía `.gitignore`, gestionado automáticamente por `amalia init`/`amalia doctor` (ver "Distribución e Instalación → Amalia no forma parte del repositorio orquestado").
- **Nombre/ruta del panal configurable**: `--honeycomb-path` en `amalia init` permite no usar `honeycomb/` como nombre; la elección queda persistida en `.amalia-root`, que el CLI consulta en cada comando para ubicar el panal real.

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

*Documento de especificación v13.0 — Se marca explícitamente que todo este documento corresponde a la **Fase 1** del proyecto; la Fase 2 queda pendiente de definir, a iniciar solo cuando la Fase 1 esté terminada y probada. Cambios sobre v11.0: Amalia **no forma parte del repositorio orquestado** — `amalia init` genera/actualiza el `.gitignore` del repo objetivo para excluir el panal completo (`honeycomb/` o la ruta elegida) y `.amalia-root`, y `amalia doctor` verifica que esas líneas no se hayan borrado; **nombre/ruta del panal configurable** vía `--honeycomb-path` en `init`, persistido en `.amalia-root` (que pasa de marcador vacío a archivo de configuración) y consultado por todos los comandos posteriores. Se mantiene todo lo de v11.0 (rama de integración al día con `main`, roles y alcance explícitos, seguridad por token, concurrencia con `rev`/lease, Capa 2 obligatoria, distribución npm, etc.).*
