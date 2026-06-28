# Especificación de Arquitectura: Amalia — Orquestador Multi-Agente

## Visión General

**Amalia** es un sistema que permite a **múltiples motores de IA** (Claude Code, opencode, GitHub Copilot CLI, OpenAI Codex CLI, modelos locales vía Ollama, etc.) coordinarse como un enjambre de trabajo, usando la metáfora de una colmena:

- **Amalia** — el orquestador principal. Analiza el requerimiento general sobre el **repositorio original**, lo descompone en tareas y supervisa el progreso del enjambre. Amalia es en sí misma un `git worktree`.
- **Bees** — los workers especializados. Cada uno tiene un rol independiente (ej. `database-bee`, `frontend-bee`, `infrastructure-bee`) y desarrolla su tarea en su propio worktree, sin pisar el trabajo de los demás.
- **Honeycomb** — el directorio raíz que contiene los worktrees: el de Amalia y el de cada bee. Es el panal donde vive el enjambre.

La comunicación base es **vía archivos** (Capa 0), y el sistema escala hacia una API/WebSocket (Capa 1) y un dashboard (Capa 2) sin romper el protocolo base. Una pieza central es que **cada worktree puede estar potenciado por un motor de IA distinto**, declarado de forma explícita en su propio `AGENTS.md` (ver Capa 3).

## Arquitectura por Capas

Amalia se construye en capas independientes y acumulativas. Cada capa funciona sola; las superiores son opcionales y se apoyan en la anterior.

```
 Capa 2 — Dashboard Web (panal visual)
        │ lee/escribe vía REST + WebSocket
        ▼
 Capa 1 — Orchestrator API (Node.js/TypeScript)
        │ indexa y sincroniza (file watcher) ←──┐
        ▼                                       │
 Capa 0 — Protocolo de archivos (TASKS.md, RESULTS.md, AGENTS.md, locks)
        ▲                                       │
        │ leen / escriben directamente          │
 Capa 3 — Motores de Agente (Amalia y Bees) ────┘
   (Claude Code, opencode, Copilot CLI, Codex CLI, Ollama, etc.)
```

- **Capa 0 (Protocolo de archivos)**: la fuente de verdad mínima. Funciona sin ningún servidor — solo archivos `.md` y locks.
- **Capa 1 (Orchestrator API)**: opcional. Un servicio Node.js/TypeScript que observa los archivos (file watcher), mantiene un índice (SQLite/Postgres como caché, no como fuente de verdad) y expone REST + WebSocket.
- **Capa 2 (Dashboard)**: cliente web que consume la Capa 1. No toca los archivos directamente.
- **Capa 3 (Motores de Agente)**: cómo Amalia y cada Bee participan del protocolo, sin importar si el motor detrás es un CLI local (Claude Code, opencode) o una llamada a API (Claude API, OpenAI, Ollama local). En modo archivo puro si la Capa 1 no está corriendo, o vía REST si está disponible.

### Diagrama del flujo Amalia ↔ Bees (Capa 0/3)

```
                      ┌─────────────────────┐
                      │       AMALIA        │
                      │  (worktree propio)  │
                      └──────┬──────┬───────┘
                             │      │
              Asigna tareas  │      │  Lee reportes
                     ┌───────┘      └───────┐
                     ▼                      ▼
           ┌─────────────────┐    ┌─────────────────┐
           │   TASKS.md      │    │  RESULTS.md     │
           │  (cola de       │    │  (reportes      │
           │   tareas)       │    │   de bees)      │
           └────────┬────────┘    └────────▲────────┘
                    │                       │
           Hace polling             Escribe reportes
                    │                       │
           ┌────────┴────────┐    ┌────────┴────────┐
           │  ┌──────────┐   │    │  ┌──────────┐   │
           │  │database- │   │    │  │frontend- │   │
           │  │  bee     │   │    │  │  bee     │   │
           │  │ (Claude) │   │    │  │(opencode)│   │
           │  └──────────┘   │    │  └──────────┘   │
           │  AGENTS.md      │    │  AGENTS.md      │
           │  worktree:      │    │  worktree:      │
           │  database-bee/  │    │  frontend-bee/  │
           └─────────────────┘    └─────────────────┘
```

## Estructura de Directorios (Honeycomb)

```
honeycomb/
├── amalia/                      # Worktree del orquestador principal
│   ├── AGENTS.md                # Rol + motor de IA de Amalia
│   ├── TASKS.md                  # Tareas globales (vista agregada)
│   └── RESULTS.md
├── database-bee/                # Worktree: especialista en base de datos
│   ├── AGENTS.md                  # Rol + motor de IA de este bee
│   ├── TASKS.md
│   └── RESULTS.md
├── backend-api-bee/              # Worktree: especialista en API REST
│   ├── AGENTS.md
│   ├── TASKS.md
│   └── RESULTS.md
├── frontend-bee/                 # Worktree: especialista en frontend
│   ├── AGENTS.md
│   ├── TASKS.md
│   └── RESULTS.md
├── infrastructure-bee/           # Worktree: DevOps/infra
│   ├── AGENTS.md
│   ├── TASKS.md
│   └── RESULTS.md
├── orchestrator-api/             # Capa 1: servicio Node.js/TypeScript (opcional, no es worktree)
├── dashboard/                    # Capa 2: cliente web (opcional, no es worktree)
└── shared/                       # Recursos compartidos (opcional, no es worktree)
    ├── interfaces/                 # Contratos entre módulos
    └── docs/                       # Documentación global
```

- `amalia/` y `*-bee/` son **worktrees reales de Git** (`git worktree add honeycomb/database-bee <rama>`), todos apuntando al mismo repositorio original.
- `orchestrator-api/`, `dashboard/` y `shared/` son carpetas normales (no worktrees) — son infraestructura del propio sistema Amalia, no entregables del repositorio orquestado.
- Convención de nombres: todo bee usa el sufijo `-bee` (`database-bee`, `frontend-bee`, `infrastructure-bee`, `payments-bee`, etc.), describiendo su área de responsabilidad antes del sufijo.

## Capa 0 — Protocolo de Archivos

Cada worktree (Amalia o un bee) contiene los mismos tres archivos base:

### 1. `AGENTS.md` — Rol, límites y motor de IA

`AGENTS.md` tiene dos secciones obligatorias: el **rol** (qué hace este worktree) y el **motor de agente** (qué IA lo ejecuta y cómo conectarse a ella). Esta segunda sección es lo que permite que cada bee use un motor distinto (Claude Code, opencode, Copilot CLI, Codex CLI, un modelo local de Ollama, etc.) bajo un mismo protocolo.

```markdown
# Bee: database-bee

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

## Agente
- **motor**: claude-code
- **modo_conexion**: cli
- **modelo**: claude-sonnet-4-6
- **comando_arranque**: `claude --permission-mode acceptEdits -p "Lee AGENTS.md y procesa TASKS.md de este worktree"`
- **heartbeat_segundos**: 60
```

El bloque `## Agente` es **declarativo** y soporta dos modos de conexión:

- **`modo_conexion: cli`** — el motor corre como un proceso de terminal (Claude Code, opencode, Copilot CLI, Codex CLI). Se declara el `comando_arranque` exacto que el humano o el script lanzador usa para abrir esa sesión apuntando al worktree.
- **`modo_conexion: api`** — el motor se invoca por HTTP, sin sesión interactiva (Claude API, OpenAI API, o un servidor Ollama local). Se declara el `endpoint` y el nombre de la variable de entorno con la credencial (nunca la credencial en texto plano):

```markdown
## Agente
- **motor**: ollama
- **modo_conexion**: api
- **modelo**: llama3.1:70b
- **endpoint**: http://localhost:11434/api/generate
- **auth_env**: (vacío — Ollama local no requiere credencial)
- **heartbeat_segundos**: 30
```

```markdown
## Agente
- **motor**: codex-cli
- **modo_conexion**: api
- **modelo**: gpt-5-codex
- **endpoint**: https://api.openai.com/v1
- **auth_env**: OPENAI_API_KEY
- **heartbeat_segundos**: 60
```

Reglas de la sección `## Agente`:
- `motor` es un identificador libre pero conocido por el lanzador (`claude-code`, `opencode`, `copilot-cli`, `codex-cli`, `ollama`, `custom`).
- Las credenciales **nunca** se escriben en `AGENTS.md`; solo se referencia el nombre de la variable de entorno (`auth_env`) que el proceso lanzador debe tener exportada.
- `heartbeat_segundos` es el intervalo esperado de actividad; lo usa la Capa 1 (o el script de validación en modo solo-archivo) para decidir cuándo un bee se considera caído.
- Si el sistema crece y se necesitan más motores (ej. Gemini CLI, Cursor CLI), se agregan como nuevos valores de `motor` sin cambiar el esquema.

### 2. `TASKS.md` — Cola de tareas asignadas

```markdown
# Tareas

## Formato
Cada tarea tiene:
- **ID**: único (ej: `TASK-001`)
- **Estado**: `pending | in_progress | completed | blocked | failed`
- **Asignado a**: nombre del bee (o `amalia` para tareas del orquestador)
- **Prioridad**: `high | medium | low`
- **Depende de**: IDs de tareas que deben completarse primero
- **Descripción**: qué hay que hacer
- **Criterios de aceptación**: cómo se verifica que está listo
- **Lock**: `<vacío> | worker=<nombre>;pid=<pid>;ts=<timestamp ISO>`

---

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

### TASK-002
- **Estado**: in_progress
- **Asignado a**: backend-api-bee
- **Prioridad**: medium
- **Lock**: worker=backend-api-bee;pid=18432;ts=2026-06-27T10:15:00Z
- **Descripción**: Crear endpoint REST para CRUD de ExperimentRun
```

### 3. `RESULTS.md` — Reporte del bee

```markdown
# Reporte: database-bee

## TASK-001: Crear entidad ExperimentRun

### Estado: ✅ Completado

### Archivos creados/modificados
- `src/main/java/.../entity/ExperimentRunEntity.java` (creado)
- `src/main/java/.../repository/ExperimentRunRepository.java` (creado)
- `src/main/resources/application.properties` (modificado)

### Decisiones
- Se usó `GenerationType.IDENTITY` para el ID
- La FK a dataset se mapeó como `@ManyToOne`
- Se añadió `cascade = CascadeType.ALL` en la relación

### Bloqueos / Pendientes
- Ninguno

### Notas
- La entidad quedó alineada con el estándar del proyecto (ver AGENTS.md del worktree raíz)
```

### Locking y recuperación de fallos

- Antes de pasar una tarea a `in_progress`, el bee escribe el campo **Lock** con su nombre, PID y timestamp. Esto evita que dos bees tomen la misma tarea.
- Si un bee muere a mitad de tarea (terminal cerrada, proceso matado), el lock queda obsoleto. Amalia (o cualquier bee al hacer polling) considera un lock **expirado** si `ts` supera un timeout configurable (por defecto 30 min, o el `heartbeat_segundos` declarado en `AGENTS.md` multiplicado por un factor de gracia) y la tarea vuelve a `pending` (lock limpiado) para reasignación, o pasa a `blocked` si ya había reintentos previos.
- Un script de validación (`validate-tasks.ps1` / `.sh`) puede recorrer `TASKS.md` y limpiar locks expirados como tarea de mantenimiento periódica.

## Capa 3 — Modelo de Ejecución (Motores de Agente)

Cada worktree (Amalia o un bee) está potenciado por el motor de IA declarado en su `AGENTS.md`. El ciclo de vida depende del `modo_conexion`:

**Modo `cli`** (Claude Code, opencode, Copilot CLI, Codex CLI en terminal):
1. **Arranque**: un humano (o un script lanzador que lee `comando_arranque` de `AGENTS.md`) abre una terminal y ejecuta el CLI apuntando al worktree (`honeycomb/<nombre-bee>/`).
2. **Lectura de rol**: al iniciar, el agente lee su `AGENTS.md` local (rol, alcance, límites y su propia configuración de motor).
3. **Polling**: el agente entra en un loop (vía skill, hook, o instrucción del propio prompt) que revisa periódicamente su `TASKS.md` buscando tareas `pending` asignadas a su nombre.
4. **Toma de tarea**: al encontrar una, escribe el lock, cambia el estado a `in_progress` y ejecuta la tarea con sus propias herramientas (Read/Edit/Bash/etc.).
5. **Reporte**: al terminar, escribe el resultado en `RESULTS.md`, libera el lock y marca el estado final (`completed` o `failed`).
6. **Terminación**: la sesión puede cerrarse entre tareas o mantenerse corriendo en loop — decisión operativa. Si se cierra a mitad de tarea, aplica la recuperación de locks descrita arriba.

**Modo `api`** (Ollama local, OpenAI API, Claude API sin CLI interactivo):
1. **Arranque**: un proceso lanzador (parte de la Capa 1, o un script simple) lee `endpoint`, `modelo` y `auth_env` del `AGENTS.md` del bee.
2. **Invocación**: en cada ciclo de polling, el lanzador construye el prompt a partir de `AGENTS.md` + `TASKS.md`, llama al `endpoint` declarado, y aplica el resultado (ediciones de archivo, comandos) de forma controlada — este lanzador necesita su propio set acotado de herramientas (lectura/escritura de archivo, ejecución de comandos) ya que el motor no tiene un CLI agente completo detrás.
3. **Reporte y locking**: igual que en modo `cli` — el lanzador escribe el lock, ejecuta, reporta en `RESULTS.md` y libera el lock.

Amalia sigue el mismo modelo desde su propio worktree (`honeycomb/amalia/`): escribe tareas en los `TASKS.md` de cada bee y hace polling de sus `RESULTS.md` para decidir próximos pasos. El motor de Amalia se declara igual, en su propio `AGENTS.md`.

> En v1 (solo Capa 0) todo esto es polling manual/loop simple. Cuando la Capa 1 esté disponible, el polling puede sustituirse por una suscripción WebSocket — ver siguiente sección.

## Capa 1 — Orchestrator API (Node.js / TypeScript)

Servicio opcional que **no reemplaza** el protocolo de archivos: lo observa y lo expone. Sincroniza vía un *file watcher* sobre `honeycomb/**/TASKS.md` y `RESULTS.md`, manteniendo un índice en SQLite (o Postgres si se requiere multi-host) como caché de consulta rápida — los `.md` siguen siendo la fuente de verdad.

Adicionalmente, para los bees en `modo_conexion: api`, esta capa puede asumir el rol de **lanzador**: lee el `AGENTS.md` de cada bee en modo API, ejecuta las llamadas al motor correspondiente (Ollama, OpenAI, etc.) y aplica los resultados al worktree.

### API REST
- `POST /api/orchestrator/tasks` — crear tarea (escribe en el `TASKS.md` del bee destino)
- `GET /api/orchestrator/tasks` — listar tareas (lee del índice)
- `PATCH /api/orchestrator/tasks/:id/status` — actualizar estado (escribe en archivo + actualiza índice)
- `POST /api/orchestrator/bees/register` — registrar un bee activo (nombre, worktree, motor, PID o modo de conexión)
- `GET /api/orchestrator/bees` — listar bees activos, su motor declarado y su última actividad

### WebSocket (Socket.io)
- Eventos: `task:created`, `task:status_changed`, `bee:registered`, `bee:heartbeat`
- Sustituye el polling manual de la Capa 3 cuando el agente puede recibir eventos en tiempo real además de leer archivos.

### Stack
- Node.js + TypeScript
- Socket.io para tiempo real
- SQLite por defecto (cero configuración); Postgres opcional para despliegues compartidos
- Chokidar (o similar) como file watcher de la Capa 0

## Capa 2 — Dashboard Web

Cliente que consume exclusivamente la API/WebSocket de la Capa 1 (nunca lee archivos directamente):

- Tablero de bees activos, con su motor de IA visible (Claude Code, opencode, Ollama, etc.)
- Cola de tareas con filtros por estado/bee
- Vista de detalle de tarea
- Historial de reportes
- Capacidad de crear tareas manualmente desde la UI

Stack sugerido: HTML + JS vanilla o un framework ligero (Svelte/React), consumiendo el WebSocket para refresco en tiempo real.

## Roadmap de Fases

### Fase 1 — Protocolo de archivos (Capa 0, base obligatoria)
- [ ] Templates de `AGENTS.md` (incluyendo bloque `## Agente`), `TASKS.md`, `RESULTS.md`
- [ ] Esquema y validación del bloque `## Agente` (motores soportados: `claude-code`, `opencode`, `copilot-cli`, `codex-cli`, `ollama`, `custom`)
- [ ] Campo `Lock` en `TASKS.md` y lógica de expiración de locks
- [ ] Script `bee-poll.sh` / `bee-poll.ps1` para que un bee detecte nuevas tareas
- [ ] Script `validate-tasks.ps1` / `.sh` para limpiar locks expirados y validar formato
- [ ] Convención de nomenclatura `<área>-bee` y de tareas

### Fase 2 — Orchestrator API (Capa 1)
- [ ] Servicio Node.js/TypeScript con file watcher sobre `honeycomb/**`
- [ ] API REST (tareas, registro de bees)
- [ ] WebSocket (Socket.io) para eventos en tiempo real
- [ ] Lanzador para bees en `modo_conexion: api` (Ollama, OpenAI, etc.)
- [ ] Índice en SQLite (caché), opcional Postgres

### Fase 3 — Dashboard web (Capa 2)
- [ ] Tablero de bees activos (con motor visible)
- [ ] Cola de tareas con filtros por estado/bee
- [ ] Vista de detalle de tarea + historial de reportes
- [ ] Creación manual de tareas desde la UI

### Fase 4 — Integración con motores (Capa 3)
- [ ] Skill/hook para Claude Code que hace polling de `TASKS.md`/`RESULTS.md` (modo archivo puro)
- [ ] Modo alternativo: el mismo skill llamando a la API REST/WebSocket de la Capa 1 cuando está disponible
- [ ] Agente equivalente para opencode, Copilot CLI y Codex CLI
- [ ] Lanzador genérico para motores en `modo_conexion: api` (Ollama y otros)

## Consideraciones Técnicas

- **Git Worktrees**: `amalia/` y cada `*-bee/` son worktrees reales (`git worktree add`) del repositorio original bajo `honeycomb/`, permitiendo cambios paralelos sin conflictos de working directory.
- **Multi-motor**: el sistema es agnóstico al motor de IA; cada worktree declara el suyo en `AGENTS.md` (`## Agente`). Añadir un nuevo motor no requiere cambios estructurales, solo soporte del lanzador correspondiente.
- **Seguridad de credenciales**: ninguna API key se escribe en `AGENTS.md` ni se versiona en Git; solo se referencian nombres de variables de entorno (`auth_env`).
- **Lock de tareas**: campo `Lock` en `TASKS.md` con `worker/pid/timestamp` + timeout de expiración (ver Capa 0).
- **Detección de bees caídos**: si la Capa 1 está activa, se usa heartbeat vía WebSocket comparado contra `heartbeat_segundos`; en modo solo-archivo (Capa 0), se infiere por lock expirado.
- **Validación de formato**: script que verifica que `AGENTS.md`/`RESULTS.md`/`TASKS.md` siguen la plantilla esperada, incluyendo el esquema del bloque `## Agente`.
- **Degradación elegante**: el sistema debe funcionar completo solo con la Capa 0. Cada capa superior es un complemento, nunca una dependencia dura de las capas inferiores.
- **Escalabilidad**: el protocolo de archivos (Capa 0) es el mínimo común denominador; las capas 1-3 montan sobre él API, WebSocket, dashboard e integración multi-motor sin reemplazarlo.

## Tecnologías

| Componente | Tecnología |
|-----------|------------|
| Orchestrator API (Capa 1) | Node.js + TypeScript |
| WebSocket | Socket.io |
| Persistencia/índice (Capa 1) | SQLite (default) / PostgreSQL (opcional) |
| File watcher | Chokidar (o equivalente) |
| Dashboard (Capa 2) | HTML + JS vanilla / Svelte / React |
| Motores de Amalia/Bees (Capa 3) | Claude Code, opencode, Copilot CLI, Codex CLI, Ollama (modelos locales), u otros vía API |
| Control de versiones | Git con worktrees (`honeycomb/`) |

---

*Documento de especificación v3.0 — Amalia: arquitectura por capas (archivos → API → dashboard → integración multi-motor), estructura `honeycomb/` con worktrees `amalia` + `*-bee`, configuración declarativa de motor de IA en `AGENTS.md`*
