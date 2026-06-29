# PLAN 03 — Etapa 3: CLI `amalia` y Empaquetado npm

> Lee primero [`PLAN-00-INDICE.md`](PLAN-00-INDICE.md) y termina las Etapas 1 y 2.

## Objetivo

Construir el binario `amalia`: bootstrap del panal (`init`), control del API (`start`/`stop`),
alta/baja de bees (`hatch`/`kill`), gestión de tareas, integración Git (`update`/`integrate`),
réplica en archivos (`tasks/`), y diagnóstico (`doctor`). Dejar el paquete listo para publicar en npm.

## Prerrequisitos

- Etapas 1 y 2 completas (DB + API funcionando).

## Decisiones ya tomadas (no las cambies)

- El CLI **NO escribe directo a la DB** (salvo `init`, que crea el `.db` y aplica el esquema).
  Todo lo demás llama a la API por HTTP con `fetch` y el token de operador.
- **Git siempre con `execFile`** (`node:child_process`), argumentos en array, nunca shell.
- El panal por defecto es `honeycomb/`; configurable con `--honeycomb-path` y guardado en `.amalia-root`.
- La rama objetivo (`target_branch`) es la rama actual del repo al correr `init`, guardada en `.amalia-root`.

---

## Tarea 3.1 — Entry point del binario

**Acción:** crea `bin/amalia.js`:

```js
#!/usr/bin/env node
import("../dist/cli/index.js");
```

**Acción:** crea `src/cli/index.ts` que registra los comandos con `commander` y parsea `process.argv`.
Estructura: un archivo por comando en `src/cli/commands/`, cada uno exporta una función
`registerXxx(program)`.

**Verificación:** tras `npm run build`, `node bin/amalia.js --help` lista los comandos.

---

## Tarea 3.2 — Localización del panal y config `.amalia-root`

**Acción:** crea `src/cli/config.ts`:

- `findRoot(startDir): string | null` — sube directorios buscando `.amalia-root`; devuelve la ruta de la raíz del repo o `null`.
- `readConfig(rootDir): AmaliaConfig` — parsea `.amalia-root` (YAML con `honeycomb_path` y `target_branch`).
- `writeConfig(rootDir, config): void`.
- Tipo `AmaliaConfig = { honeycomb_path: string; target_branch: string }`.
- Helpers de rutas derivadas: `honeycombDir`, `amaliaWorktree`, `beeWorktree(name)`, `orchestratorApiDir`, `secretsDir`, `dbPath`.

> Usa `gray-matter` o un parser YAML simple; como `.amalia-root` es pequeño, puedes usar
> `gray-matter` envolviendo el contenido, o un parse manual `key: value`. Mantén formato YAML.

**Verificación:** test `src/cli/config.test.ts`: escribe y relee un config; `findRoot` lo
encuentra desde un subdirectorio.

---

## Tarea 3.3 — Helpers de Git (seguros)

**Acción:** crea `src/cli/git.ts`. Todas las funciones usan `execFile("git", [args], { cwd })`
y devuelven `{ stdout, stderr, code }`. **Nunca** uses `exec` con string.

Funciones mínimas:
- `gitVersion()` → string, o lanza si Git no está.
- `isInsideWorkTree(cwd)` → boolean.
- `currentBranch(cwd)` → nombre de rama.
- `worktreeAdd(repoDir, path, branch)` → crea worktree.
- `worktreeRemove(repoDir, path, force)` → `git worktree remove [--force] <path>`.
- `statusPorcelain(cwd)` → string (vacío = árbol limpio).
- `fetch(cwd)`, `rebase(cwd, target)`, `mergeNoFf(cwd, branch)`, `cherryPick(cwd, sha)`, `cherry(cwd, target, branch)`.
- `hasConflicts(cwd)` → boolean (revisa `git status --porcelain` por marcadores `UU`/`AA`/`DD`).
- `rebaseAbort(cwd)`, `mergeAbort(cwd)`.

**Seguridad:** valida `branch`/`sha` con las regex de `validation.ts` antes de pasarlos a Git.

**Verificación:** test `src/cli/git.test.ts` que crea un repo temporal (`git init` en una carpeta
temporal), hace un commit, y verifica `currentBranch` y `statusPorcelain` vacío.

---

## Tarea 3.4 — Réplica en archivos (`tasks/`) y frontmatter

**Acción:** crea `src/cli/replica.ts`. Maneja los archivos de cada worktree con `gray-matter`.

- `writeTaskFile(beeDir, task)` — crea/actualiza `tasks/<slug>.task.md` con el frontmatter
  estricto (campos: `id, slug, estado, asignado_a, prioridad, depende_de, rev, synced_rev, lock,
  ultima_sync_db`) y un cuerpo con descripción + criterios.
- `readTaskFile(beeDir, slug)` — devuelve `{ frontmatter, body }`.
- `upsertTasksSummary(beeDir, tasks)` — regenera la tabla de `tasks/tasks.md`.
- `writeResultFile(beeDir, result)` y `upsertResultsSummary(beeDir, results)`.

> El cuerpo (prosa) NUNCA se parsea para datos; solo el frontmatter. Ver especificación
> ("El bloque de metadatos es de formato estricto").

**Verificación:** test `replica.test.ts`: escribe un task file, reléelo, verifica que el
frontmatter tiene `rev` y `synced_rev`.

---

## Tarea 3.5 — `amalia init`

**Acción:** crea `src/cli/commands/init.ts`. Pasos (aborta limpio si algo falla, sin dejar archivos a medias):

1. **Precondiciones** (ver especificación → "Precondiciones de instalación"):
   - `git --version` funciona y versión >= 2.5.
   - `git rev-parse --is-inside-work-tree` es true y estamos en la raíz.
   - Node >= 20.
2. Determinar `honeycomb_path` (flag `--honeycomb-path` o `honeycomb`) y `target_branch` (`currentBranch`).
3. Crear carpetas: `<panal>/`, `<panal>/orchestrator-api/`, `<panal>/orchestrator-api/.secrets/`, `<panal>/dashboard/`.
4. Crear `amalia.db` (`openDb` + `applySchema` de la Etapa 1).
5. **Generar token de operador**: `generateToken()`, guardar texto en `.secrets/amalia.token`
   (permisos restrictivos: `chmod 0600` vía `fs.chmodSync`), y crear la fila `amalia` en `bees`
   con su `token_hash` (insert directo, única vez, porque la API aún no corre).
6. Crear el worktree `<panal>/amalia/` (rama de integración derivada de `target`) con
   `git worktree add`, y copiar plantillas `AGENTS.md`/`bee.md`/`tasks/` (de `templates/`).
7. Escribir `.amalia-root` con `honeycomb_path` y `target_branch`.
8. Actualizar `.gitignore` (Tarea 3.6).

**Verificación:** test `test/init.test.ts`: en un repo temporal, corre la lógica de init;
verifica que existen `.amalia-root`, `<panal>/orchestrator-api/amalia.db`, `.secrets/amalia.token`,
y que `getSchemaVersion` de la DB creada es 1.

---

## Tarea 3.6 — Gestión de `.gitignore`

**Acción:** crea `src/cli/gitignore.ts` con `ensureGitignore(rootDir, honeycombPath)`:
- Añade un bloque delimitado por marcadores de comentario:
  ```
  # Amalia — generado automáticamente por `amalia init`, no editar a mano esta sección
  .amalia-root
  <honeycombPath>/
  # Fin Amalia
  ```
- Si el archivo no existe, lo crea. Si existe pero no tiene el bloque, lo **agrega** (no sobreescribe).
- Si el bloque ya está, no duplica.
- `checkGitignore(rootDir, honeycombPath): boolean` para `amalia doctor`.

**Verificación:** test: correr dos veces no duplica el bloque; respeta contenido previo.

---

## Tarea 3.7 — `start` / `stop`

**Acción:** `src/cli/commands/start.ts`:
- Abre la DB, verifica `isSchemaCurrent` (Etapa 1). Si la DB está atrasada, **no arranca**:
  imprime "Esquema desactualizado, corre `amalia doctor`" y sale con código != 0.
- Levanta el server de la Etapa 2 (`createServer(db).listen(port)`) en `127.0.0.1`.
- Inicia el scheduler de mantenimiento.
- Guarda el PID en `<panal>/orchestrator-api/api.pid` para que `stop` lo encuentre.

**Acción:** `src/cli/commands/stop.ts`: lee `api.pid` y termina el proceso; borra el archivo PID.

**Verificación:** manual/integración: `amalia start` responde a `GET /api/orchestrator/bees`
(con token operador) y `amalia stop` lo detiene. Documenta el comando de prueba en el test.

---

## Tarea 3.8 — `hatch` / `kill`

**Acción:** `src/cli/commands/hatch.ts` (`amalia hatch <nombre-bee> [--role] [--engine] [--branch]`):
1. Validar `<nombre-bee>` contra `BEE_NAME_RE`.
2. **Pre-crear el token del bee**: `generateToken()`, guardar en `.secrets/<bee>.token` (0600).
3. Crear la fila en `bees` con su `token_hash` (vía API `POST /bees/register` con token operador,
   o, si la API no corre, error claro pidiendo `amalia start`). La identidad se crea aquí para
   que el primer `register` del propio bee ya esté autenticado (ver especificación → Seguridad).
4. Crear el `git worktree` `<panal>/<bee>/` sobre `--branch` (o una rama derivada de `target`).
5. Copiar plantillas `AGENTS.md`/`bee.md`/`tasks/` y rellenarlas (nombre, engine, role).

**Acción:** `src/cli/commands/kill.ts` (`amalia kill <nombre-bee> [--force]`):
1. Comprobar trabajo sin integrar: `git cherry <target> <rama-del-bee>` no vacío, o tareas
   `pending`/`in_progress` del bee. Si hay y no `--force` → **rehúsa** y lista qué se perdería.
2. Ofrecer reasignar tareas `pending` a otro bee nombrado (cambiar `assigned_to` vía API).
3. `git worktree remove` (con `--force` solo si se pidió), borrar `.secrets/<bee>.token`,
   borrar la fila en `bees` vía API.

**Verificación:** test de `hatch` en repo temporal: crea el worktree y el token; `kill` sin
`--force` rehúsa si hay commits sin integrar.

---

## Tarea 3.9 — Comandos de tareas y supervisión

**Acción:** implementa, todos vía `fetch` a la API con token operador:
- `task add <bee> "<desc>" [--priority] [--depends-on TASK-ID]` → `POST /tasks`. Tras crear,
  escribe el `tasks/<slug>.task.md` en el worktree destino y actualiza `tasks/tasks.md`.
- `task list [--status] [--bee]` → `GET /tasks`, imprime tabla.
- `task show <code>` → detalle.
- `check [<bee>]` → `GET /bees` (+ tareas). Si la API no responde, lee los `tasks/*.md` locales.
- `logs <bee>` → muestra `tasks/results.md` + eventos recientes (`GET /events`).

**Verificación:** test de integración: con el API arriba, `task add` crea la tarea y aparece en `task list`.

---

## Tarea 3.10 — `update`, `integrate`, `sync`, `doctor`

**Acción:** `update.ts` (`amalia update`):
1. Detectar si el repo padre cambió de rama objetivo (comparar `currentBranch` del repo padre
   con `target_branch` de `.amalia-root`); si cambió, reportar evento `update:conflict`/actualizar config tras confirmar.
2. `git fetch`; `git rebase <target>` en el worktree de Amalia.
3. Si el rebase falla (conflictos): `git rebase --abort`, marcar inconsistencia
   (fila en `integrations` o evento `update:conflict` vía API) y mostrar instrucciones al humano.

**Acción:** `integrate.ts` (`amalia integrate <bee> [<commit>]`):
1. Precondición: árbol limpio del worktree de Amalia (`statusPorcelain` vacío) y sin otra
   integración `pending`/`conflict` (lock de integración). Si no, rehúsa.
2. Crear fila `integrations` (status `pending`) vía API.
3. Ejecutar `git cherry-pick <commit>` (si se dio) o `git merge --no-ff <rama-del-bee>`.
4. Sin conflicto → `status='success'`, leer trailers `Amalia-Task:` de los commits para llenar
   `covered_tasks`, emitir `integration:success`.
5. Con conflicto → dejar el árbol como está, `status='conflict'` + `conflicting_files`, emitir
   `integration:conflict`. NO resolver.
6. `integrate --resolve <id>` → marcar la fila como `success`/`aborted` con `resolved_by`.

**Acción:** `sync.ts` (`amalia sync`): reconciliación archivo↔DB por `rev`/`synced_rev`
(ver especificación → "Modo degradado y reconciliación"). Emite `reconcile:conflict` cuando
ambos lados avanzaron sobre `synced_rev`.

**Acción:** `doctor.ts` (`amalia doctor`):
- Revalida Git/worktree/Node.
- Compara `schema_version` y aplica `migrate` si la DB está atrás.
- Verifica el bloque de `.gitignore` (`checkGitignore`).
- Limpia leases vencidos; detecta bees con heartbeat vencido.
- Verifica el frontmatter de cada `tasks/<slug>.task.md` (lo reconstruye desde la DB si está corrupto).

**Verificación:** test de `doctor`: sobre una DB atrasada (simulada), `doctor` la migra y
`isSchemaCurrent` queda true.

---

## Tarea 3.11 — Plantillas y empaquetado

**Acción:** crea `templates/AGENTS.md`, `templates/bee.md`, `templates/tasks/tasks.md`,
`templates/tasks/results.md` siguiendo los ejemplos de la especificación (Capa 3). En `bee.md`
incluye la sección `## Convención de Trabajo` con la regla del trailer `Amalia-Task:`.

**Acción:** ajustes de `package.json` para publicar:
- `"files": ["dist", "bin", "templates", "src/db/schema.sql"]`
- Asegura que el `build` copie `schema.sql` y `templates/` a donde el runtime los espera.
- `"prepublishOnly": "npm run build && npm test"`.

**Verificación:** `npm pack` genera el tarball e incluye `dist/`, `bin/`, `templates/`. No publiques aún.

---

## Definición de Hecho (Etapa 3)

- [ ] `bin/amalia.js` + `src/cli/index.ts` con todos los comandos registrados.
- [ ] `config.ts`, `git.ts`, `replica.ts`, `gitignore.ts` con tests.
- [ ] `init`, `start`, `stop`, `hatch`, `kill`, `task add/list/show`, `check`, `logs`, `update`,
      `integrate`, `sync`, `doctor` implementados.
- [ ] Plantillas en `templates/`.
- [ ] `npm pack` produce un paquete con `dist`, `bin`, `templates`, `schema.sql`.
- [ ] `npm run typecheck` y `npm test` pasan.
