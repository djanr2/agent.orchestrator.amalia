# Amalia

**Orquestador multi-agente sobre git worktrees.**

Amalia coordina varios agentes de IA (Claude Code, OpenCode, Ollama) trabajando en paralelo sobre el mismo repositorio, cada uno aislado en su propio git worktree. Se le asignan tareas por CLI o por API, cada agente ("bee") reclama las suyas, las ejecuta, reporta resultados y su trabajo se integra de vuelta en una rama central llamada `amalia`.

## Qué aporta Amalia

- **Aislamiento por worktree.** Cada bee vive en `honeycomb/<bee>/` con su propia rama (`bee/<name>`). No hay conflictos por ramas compartidas ni por directorios de trabajo pisándose.
- **Cola de tareas persistente.** SQLite local (`honeycomb/orchestrator-api/amalia.db`) con `bees`, `tasks`, `task_dependencies`, `results`, `integrations` y `events`. Soporta prioridades, reintentos, dependencias, leases y control optimista de concurrencia (`rev`).
- **API HTTP + WebSocket.** Servidor Express en `:4000` con autenticación por token bearer (`Bearer <token>` por bee) y eventos en tiempo real vía Socket.IO para el dashboard.
- **Dashboard web.** Vista servida en `http://127.0.0.1:4000/` para observar bees, tareas y eventos sin depender de la CLI.
- **Réplica en archivos.** Cada tarea se escribe también como `tasks/<slug>.task.md` con frontmatter dentro del worktree del bee, para que el agente lea instrucciones sin necesidad de la API.
- **Adaptadores de motor.** `claude-code`, `opencode` y `ollama`, todos configurables desde `bee.md` (`engine`, `model`, `start_command`).
- **Integración por git.** El trabajo de un bee se integra en la rama `amalia` vía `merge --no-ff` o `cherry-pick`, usando el trailer `Amalia-Task: TASK-XX` para trazabilidad.
- **Recuperación segura.** `init` hace rollback si algo falla, `doctor` diagnostica y auto-repara `.gitignore` y migraciones de esquema, `kill` bloquea eliminar bees con trabajo sin integrar salvo `--force`.
- **La reina es intocable.** El bee `amalia` no puede ser eliminado con `kill`.

## Requisitos

- Node.js **>= 20** (recomendado 24)
- Git **>= 2.5** (soporte de worktrees)
- Estar dentro de un repositorio git

## Instalación

```bash
npm install
npm run build
npm link   # opcional, para usar `amalia` global
```

## Ciclo de vida típico

```bash
amalia init                                     # crea el hive
amalia start -d                                 # arranca la API en background
amalia hatch database-bee --engine claude-code  # crea un bee
amalia task add database-bee "Migrar schema X"  # le asigna una tarea
amalia run database-bee                         # el bee reclama y ejecuta
amalia check                                    # observa el estado
amalia integrate merge database-bee             # integra su trabajo en amalia
amalia stop                                     # apaga la API
```

## Comandos

Todos los comandos se ejecutan desde cualquier directorio dentro del repo: Amalia localiza el hive subiendo hasta encontrar `.amalia-root`.

### `amalia init`

Inicializa un nuevo hive en el repositorio actual.

- Verifica Git >= 2.5, Node >= 20, y que estés dentro de un worktree.
- Crea `honeycomb/`, `honeycomb/orchestrator-api/`, `honeycomb/.secrets/`, `honeycomb/dashboard/`.
- Crea la base SQLite y aplica el esquema.
- Genera el token del operador (guardado en `.secrets/amalia.token`, permisos 600).
- Crea el worktree `honeycomb/amalia/` sobre la rama actual y renderiza `AGENTS.md` + `bee.md` + `tasks/`.
- Inserta el bee `amalia` en la DB, escribe `.amalia-root` y añade el bloque de `.gitignore`.
- **Rollback completo** si algo falla a mitad de camino.

Opciones:
- `--honeycomb-path <path>` — ruta del hive (default: `honeycomb`).

### `amalia start`

Arranca el servidor API del orquestador.

- Valida que la versión de esquema coincida con la del código (sugiere `amalia doctor` si no).
- Levanta Express + Socket.IO y el scheduler de jobs.
- Sirve el dashboard estático si `dashboard/` existe.
- Escribe `api.pid` para permitir `amalia stop`.
- Muestra el token del operador y la URL clickeable (OSC 8).

Opciones:
- `-p, --port <port>` — puerto (default: `4000`, env `AMALIA_PORT`).
- `-d, --detach` — corre en background y libera la terminal (logs en `honeycomb/orchestrator-api/api.log`).

### `amalia stop`

Detiene el servidor lanzado con `start`. Lee `api.pid`, envía `SIGTERM` y borra el archivo de PID.

### `amalia hatch <name>`

Crea un nuevo bee en el hive.

- Valida que el nombre matchee el patrón `<algo>-bee`.
- Inserta el bee en la DB, genera su token (`.secrets/<name>.token`, 600).
- Crea el worktree `honeycomb/<name>/` sobre la rama `bee/<name>`.
- Renderiza `bee.md` + `AGENTS.md` + `tasks/tasks.md` + `tasks/results.md` con `engine`, `model` y `start_command` por defecto según el motor.
- **Rollback completo** si falla la creación del worktree.

Argumentos:
- `<name>` — nombre del bee (ej: `database-bee`).

Opciones:
- `--engine <engine>` — motor a usar (`opencode`, `claude-code`, `ollama`). Default: `opencode`.
- `--branch <branch>` — rama del worktree (default: `bee/<name>`).
- `--role <role>` — descripción libre del rol del bee.

### `amalia kill <name>`

Elimina un bee del hive: DB, token, worktree y rama.

- Rechaza `amalia` (la reina no se toca).
- Si el bee tiene tareas `pending` o `in_progress`, exige `--force` o `--reassign-to`.
- Si su rama tiene commits que no llegaron a `target_branch`, exige `--force`.
- Reasignar mueve **todas** las tareas del bee al destino (evita romper la FK).

Opciones:
- `--force` — remueve aunque haya trabajo pendiente o commits sin integrar.
- `--reassign-to <bee>` — transfiere las tareas a otro bee antes de eliminar.

### `amalia run <bee>`

Lanza el runtime del bee: reclama tareas pendientes de la API y las ejecuta con el motor configurado en su `bee.md`.

- Verifica que el worktree y el token del bee existan.
- Corre en loop como daemon salvo `--once`.
- Cierra sockets de fetch al terminar en modo `--once` para no dejar el proceso colgado.

Opciones:
- `--once` — ejecuta un único ciclo *claim → execute → report* y sale.

### `amalia task`

Gestión de tareas contra la API. Requiere que el servidor esté corriendo.

#### `amalia task add <bee> <description>`

Crea una tarea y actualiza el archivo local del bee.

- Calcula el `slug` a partir de la descripción (o del `--slug` dado).
- Registra dependencias por código (`TASK-XX`).
- Escribe `tasks/<slug>.task.md` y actualiza el resumen `tasks/tasks.md` del bee.

Opciones:
- `--priority <priority>` — `high`, `medium`, `low` (default: `medium`).
- `--depends-on <codes>` — códigos de tareas prerequisito, separados por coma.
- `--slug <slug>` — override del slug autogenerado.

#### `amalia task list`

Lista tareas con filtros opcionales.

Opciones:
- `--status <status>` — filtra por estado.
- `--bee <bee>` — filtra por bee asignado.

#### `amalia task retry <code>`

Mueve una tarea `blocked` o `failed` de vuelta a `pending`, reseteando el contador de intentos.

#### `amalia task show <code>`

Muestra el detalle de una tarea (código, slug, estado, prioridad, asignación, descripción, `rev`, `block_reason`).

### `amalia check [bee]`

Muestra el estado de los bees y sus tareas. Si la API está viva, la consulta; si no, cae a leer los worktrees locales y contar `.task.md`.

Argumentos:
- `[bee]` — opcional, filtra por un bee específico.

### `amalia logs <bee>`

Muestra los eventos recientes del bee (últimos 20) desde la API. Si la API no responde, imprime el `tasks/results.md` local del bee.

### `amalia update`

Actualiza el worktree de `amalia` contra `target_branch`.

- Detecta si la rama del repo cambió y sincroniza `.amalia-root`.
- `git fetch` + `git rebase` sobre la target branch.
- Si hay conflictos, aborta el rebase automáticamente y pide `amalia integrate`.

### `amalia integrate`

Integra el trabajo de un bee en el worktree de `amalia`. Requiere que la Amalia esté limpia.

#### `amalia integrate merge <bee>`

`git merge --no-ff bee/<name>` sobre `honeycomb/amalia/`. En conflicto, indica resolver a mano.

#### `amalia integrate cherry-pick <bee> <sha>`

`git cherry-pick <sha>` sobre `honeycomb/amalia/`. Valida el SHA antes de ejecutar.

### `amalia sync`

Reconcilia los archivos locales `tasks/<slug>.task.md` con la base de datos.

- Descarga las tareas de la API y las agrupa por bee.
- Si un archivo local tiene `rev` menor que la DB, lo reescribe.
- Si el local tiene `rev` mayor que la DB, imprime un aviso de conflicto (no sobreescribe).

### `amalia doctor`

Diagnóstica y repara el hive.

- Chequea Git, estar dentro de repo, rama actual.
- Verifica el bloque de `.gitignore` de Amalia y lo reinsera si falta.
- Verifica la existencia y versión del esquema de la DB, corriendo `migrate` si está desactualizada.
- Verifica que el worktree de `amalia` exista.
- Sale con código != 0 si algún check no se pudo reparar.

## Motores soportados

Cada bee se configura editando su archivo `honeycomb/<bee>/bee.md`. El runtime (`amalia run <bee>`) lee las secciones `## Engine` y `## Orchestrator API Connection` con formato `- **Clave:** valor`.

Los tres adaptadores comparten:
- **Prompt fijo**: `descripción + acceptance criteria`, más una instrucción de "escribe tu duda al final si necesitas aclaración" en claude/opencode.
- **Env vars inyectadas**: `AMALIA_TASK_CODE` y `AMALIA_BEE_NAME`. Si defines `Auth env var`, Amalia copia esa variable del entorno del operador al proceso del bee (útil para `ANTHROPIC_API_KEY`, etc.).
- **`start_command` no soporta quoting**: se hace un split naive por espacios. Si necesitas comillas o pipes, mete el comando en un wrapper script y apunta ahí.

### Claude Code (`claude-code`)

Ejecuta el CLI `claude` localmente y le pasa el prompt como último argumento posicional.

- **Comando por defecto**: `claude -p --allowedTools Read,Edit,Write,Bash --permission-mode acceptEdits`
- **Modelo por defecto**: `claude-sonnet-4-6` (se inyecta como `--model <model>` si no está ya en el `start_command`).
- **Requisitos**: `claude` en el `PATH` y autenticación (típicamente `ANTHROPIC_API_KEY` o login OAuth previo).
- **Timeout**: 5 minutos por tarea, buffer de 10 MB.
- **Windows**: los shims `.cmd` de npm se resuelven directo al `.exe` (o al `node <script>`) para no pasar por `cmd.exe` y evitar inyección de shell.

Ejemplo de `bee.md`:

```md
## Engine

- **Engine:** claude-code
- **Connection mode:** cli
- **Model:** claude-sonnet-4-6
- **Start command:** claude -p --allowedTools Read,Edit,Write,Bash --permission-mode acceptEdits
- **Endpoint:**
- **Auth env var:** ANTHROPIC_API_KEY
```

Crear el bee: `amalia hatch backend-bee --engine claude-code`.

### OpenCode (`opencode`)

Comparte el adaptador de `claude-code` (mismo flujo `execFile` + prompt posicional), pero con dos diferencias clave.

- **Comando por defecto**: `opencode run --auto`
- **Modelo por defecto**: `opencode/big-pickle` (también se inyecta como `--model <model>`).
- **Peculiaridad importante**: se le agrega automáticamente `--dir <beeDir>` porque `opencode run` **no** hereda el `cwd` del proceso padre como sí lo hace `claude`. Si tu `start_command` ya incluye `--dir`, Amalia respeta el tuyo.

Ejemplo de `bee.md`:

```md
## Engine

- **Engine:** opencode
- **Connection mode:** cli
- **Model:** opencode/big-pickle
- **Start command:** opencode run --auto
- **Endpoint:**
- **Auth env var:**
```

Crear el bee: `amalia hatch frontend-bee --engine opencode`. Es el motor default de `hatch`.

### Ollama (`ollama`)

**No ejecuta un CLI**: hace `POST` HTTP a la API de Ollama. Esto tiene implicaciones fuertes.

- **Endpoint por defecto**: `http://localhost:11434/api/generate` (override con el campo `Endpoint` en `bee.md`).
- **Modelo por defecto**: `llama3`. Se manda en el body de la request, **no** como flag.
- **`Start command` se ignora**: no hay proceso local que arrancar.
- **`stream: false`**: espera la respuesta completa antes de cerrar.
- **Limitación clave**: Ollama devuelve texto plano. El adaptador guarda ese texto en `notes` del resultado, pero **no modifica archivos** ni ejecuta comandos por sí solo. Sirve como agente consultor / generador de propuestas, no como editor autónomo. Para automatizar edits sobre lo que responde el modelo hay que integrarlo desde fuera.

Ejemplo de `bee.md`:

```md
## Engine

- **Engine:** ollama
- **Connection mode:** cli
- **Model:** llama3
- **Start command:**
- **Endpoint:** http://localhost:11434/api/generate
- **Auth env var:**
```

Crear el bee: `amalia hatch reviewer-bee --engine ollama`.

## Estructura de directorios

```
<repo>/
├── .amalia-root                        # marca del hive (config JSON)
└── honeycomb/
    ├── amalia/                         # worktree de integración
    ├── <bee>/                          # un worktree por bee
    │   ├── bee.md                      # config del bee (engine, modelo, endpoint)
    │   ├── AGENTS.md
    │   └── tasks/
    │       ├── tasks.md                # resumen legible
    │       ├── results.md
    │       └── <slug>.task.md          # una tarea por archivo (frontmatter)
    ├── orchestrator-api/
    │   ├── amalia.db                   # SQLite
    │   ├── api.pid
    │   └── api.log
    ├── .secrets/
    │   ├── amalia.token                # token del operador
    │   └── <bee>.token                 # un token por bee
    └── dashboard/
```

## Autenticación

Cada request a la API va con `Authorization: Bearer <token>`. Cada bee tiene su propio token; el token de `amalia` es el del operador y tiene permisos plenos. Los tokens se guardan hasheados en la DB (`token_hash`) y en claro en `.secrets/` con permisos 600.

## Licencia

MIT.
