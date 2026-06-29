# PLAN 01 — Etapa 1: Modelo de Datos (Capa 0)

> Lee primero [`PLAN-00-INDICE.md`](PLAN-00-INDICE.md). Haz las tareas en orden.
> No avances con una tarea hasta que su verificación pase.

## Objetivo

Dejar listo el proyecto npm + TypeScript y la **base de datos SQLite** con su esquema y un
sistema de **migraciones** versionado. Al terminar, otro código podrá abrir `amalia.db`,
tenerla con el esquema correcto, y consultar/insertar filas.

## Prerrequisitos

- Ninguno (es la primera etapa).
- **Node.js >= 24** instalado (`node --version` debe mostrar v24 o superior). Es un **requisito duro**:
  `node:sqlite` no existe en Node 20/22. Si tu versión es menor, **actualiza Node antes de empezar**
  (instalador de nodejs.org o `nvm install 24 && nvm use 24`).

## Decisiones ya tomadas (no las cambies)

- DB: **`node:sqlite`** (módulo integrado de Node, clase `DatabaseSync`; **no se instala con npm**,
  no compila nada). Tests: `vitest`. Lenguaje: TypeScript strict.
- La DB se abre SIEMPRE con `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON` y `PRAGMA busy_timeout=5000`.
- `node:sqlite` es **síncrono** (como era `better-sqlite3`): `.run()`, `.get()`, `.all()` sobre statements preparados.
- El número de versión de esquema **actual del binario** es la constante `SCHEMA_VERSION = 1`.

---

## Tarea 1.1 — Inicializar el proyecto npm

**Acción:** crea `package.json` en la raíz con este contenido exacto:

```json
{
  "name": "amalia",
  "version": "0.1.0",
  "description": "Orquestador multi-agente sobre git worktrees",
  "type": "module",
  "bin": { "amalia": "bin/amalia.js" },
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": { "node": ">=24" },
  "license": "MIT"
}
```

**Acción:** instala dependencias (exactamente estas). **`node:sqlite` NO se instala** — viene con Node:

```bash
npm install express socket.io zod commander gray-matter
npm install -D typescript vitest @types/node @types/express tsx
```

**Verificación:** `node --version` muestra v24+ y `node -e "require('node:sqlite'); console.log('ok')"`
imprime `ok` (sin ningún flag), y existe la carpeta `node_modules/`.

---

## Tarea 1.2 — Configurar TypeScript

**Acción:** crea `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

**Acción:** crea `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts", "test/**/*.test.ts"] } });
```

**Verificación:** `npx tsc --noEmit` corre sin errores (aunque aún no haya código, no debe fallar la config).

---

## Tarea 1.3 — Tipos compartidos

**Acción:** crea `src/shared/types.ts` con los tipos de dominio. Úsalos en todo el proyecto.

```ts
export type BeeStatus = "offline" | "idle" | "busy";
export type TaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "failed" | "cancelled";
export type TaskPriority = "high" | "medium" | "low";
export type BlockReason = "deps_unresolved" | "upstream_failed" | "retries_exhausted" | "timeout";
export type IntegrationStatus = "pending" | "success" | "conflict" | "aborted";
export type Outcome = "completed" | "failed";
export type Engine = "claude-code" | "opencode" | "copilot-cli" | "codex-cli" | "ollama" | "custom";
export type ConnectionMode = "cli" | "api";

export const SCHEMA_VERSION = 1;
```

**Verificación:** `npx tsc --noEmit` pasa.

---

## Tarea 1.4 — Escribir el DDL del esquema

**Acción:** crea `src/db/schema.sql` con EXACTAMENTE este contenido (es el esquema de la
especificación v14, Capa 0). No cambies nombres de columnas ni tipos.

```sql
CREATE TABLE schema_version (
  version    INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bees (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL UNIQUE,
  worktree_path     TEXT NOT NULL,
  role_summary      TEXT,
  engine            TEXT NOT NULL,
  connection_mode   TEXT NOT NULL,
  model             TEXT,
  status            TEXT NOT NULL DEFAULT 'offline',
  token_hash        TEXT NOT NULL,
  heartbeat_seconds INTEGER NOT NULL DEFAULT 60,
  last_heartbeat_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE,
  slug                TEXT NOT NULL,
  assigned_to         INTEGER NOT NULL REFERENCES bees(id),
  created_by          INTEGER NOT NULL REFERENCES bees(id),
  status              TEXT NOT NULL DEFAULT 'pending',
  priority            TEXT NOT NULL DEFAULT 'medium',
  description         TEXT NOT NULL,
  acceptance_criteria TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  max_attempts        INTEGER NOT NULL DEFAULT 3,
  block_reason        TEXT,
  max_run_seconds     INTEGER,
  rev                 INTEGER NOT NULL DEFAULT 1,
  locked_by           INTEGER REFERENCES bees(id),
  locked_by_instance  TEXT,
  lease_expires_at    TEXT,
  claimed_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assigned_to, slug)
);

CREATE TABLE task_dependencies (
  task_id            INTEGER NOT NULL REFERENCES tasks(id),
  depends_on_task_id INTEGER NOT NULL REFERENCES tasks(id),
  PRIMARY KEY (task_id, depends_on_task_id)
);

CREATE TABLE results (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         INTEGER NOT NULL REFERENCES tasks(id),
  bee_id          INTEGER NOT NULL REFERENCES bees(id),
  attempt         INTEGER NOT NULL DEFAULT 1,
  idempotency_key TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  files_changed   TEXT,
  decisions       TEXT,
  blockers        TEXT,
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (task_id, idempotency_key)
);

CREATE TABLE integrations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  bee_id            INTEGER NOT NULL REFERENCES bees(id),
  task_id           INTEGER REFERENCES tasks(id),
  covered_tasks     TEXT,
  commit_sha        TEXT,
  target_branch     TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  conflicting_files TEXT,
  resolved_by       TEXT,
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at       TEXT
);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tasks_assigned_status ON tasks(assigned_to, status);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_events_id ON events(id);
CREATE INDEX idx_results_task ON results(task_id);
```

**Verificación:** el archivo existe y `sqlite3` no es necesario; lo validamos en la Tarea 1.6.

---

## Tarea 1.5 — Módulo de apertura de la DB

**Acción:** crea `src/db/index.ts`. Debe exportar:

- `openDb(dbPath: string): DatabaseSync` — abre la DB, aplica los PRAGMAs obligatorios y la devuelve.
- `applySchema(db: DatabaseSync): void` — ejecuta `schema.sql` (solo en una DB nueva) e inserta `schema_version`.
- `getSchemaVersion(db: DatabaseSync): number` — devuelve el `version` más alto de `schema_version`, o `0` si no hay tabla/fila.
- `transaction(db, fn, immediate?)` — helper de transacción. `node:sqlite` NO trae `db.transaction()`
  como `better-sqlite3`, así que lo implementamos con `BEGIN`/`COMMIT`/`ROLLBACK`. Usa `immediate=true`
  para `BEGIN IMMEDIATE` (lo necesita el reclamo atómico de la Etapa 2).

> El tipo de la base es `DatabaseSync`, importado de `node:sqlite`. Úsalo en TODO el proyecto
> (Etapas 1-3) en lugar del antiguo `Database.Database` de better-sqlite3.

```ts
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCHEMA_VERSION } from "../shared/types.js";

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}

export function applySchema(db: DatabaseSync): void {
  const ddl = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(ddl);
  db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
}

export function getSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();
  if (!row) return 0;
  const v = db.prepare("SELECT MAX(version) AS v FROM schema_version").get() as { v: number | null };
  return v.v ?? 0;
}

/** Transacción síncrona. node:sqlite no trae db.transaction(); la hacemos a mano. */
export function transaction<T>(db: DatabaseSync, fn: () => T, immediate = false): T {
  db.exec(immediate ? "BEGIN IMMEDIATE" : "BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
```

> En **Node 24+** no hace falta ningún flag para `node:sqlite`: ni en el binario, ni en los
> tests, ni en `npm run build`. Si ves `No such built-in module: node:sqlite`, estás en una
> versión de Node menor que 24 → actualiza Node.

> IMPORTANTE: `schema.sql` es un archivo `.sql`, no `.ts`. Para que `tsc` lo copie a `dist/`,
> añade un script de copia: en `package.json`, cambia `"build"` a
> `"tsc && node -e \"require('fs').cpSync('src/db/schema.sql','dist/db/schema.sql')\""`.
> (En la Etapa 1 puedes leerlo desde `src/` durante los tests; el copiado importa para el build.)

**Verificación:** se prueba en la Tarea 1.6.

---

## Tarea 1.6 — Test del esquema

**Acción:** crea `src/db/db.test.ts`:

```ts
import { test, expect } from "vitest";
import { openDb, applySchema, getSchemaVersion } from "./index.js";

test("crea esquema en DB nueva en memoria y reporta versión", () => {
  const db = openDb(":memory:");
  expect(getSchemaVersion(db)).toBe(0);     // DB vacía
  applySchema(db);
  expect(getSchemaVersion(db)).toBe(1);     // tras aplicar
});

test("las tablas esperadas existen", () => {
  const db = openDb(":memory:");
  applySchema(db);
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  ).all().map((r: any) => r.name);
  for (const t of ["bees","tasks","task_dependencies","results","integrations","events","schema_version"]) {
    expect(tables).toContain(t);
  }
});

test("foreign_keys está activo", () => {
  const db = openDb(":memory:");
  const fk = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
  expect(fk.foreign_keys).toBe(1);
});
```

**Verificación:** `npm test` → los 3 tests pasan en verde.

---

## Tarea 1.7 — Sistema de migraciones

**Acción:** crea `src/db/migrate.ts`. Las migraciones son funciones numeradas que llevan la
DB de la versión `N-1` a `N`. La versión 1 es el esquema base (ya cubierto por `applySchema`),
así que el array empieza vacío salvo futuras versiones.

```ts
import type { DatabaseSync } from "node:sqlite";
import { SCHEMA_VERSION } from "../shared/types.js";
import { getSchemaVersion, transaction } from "./index.js";

type Migration = { to: number; up: (db: DatabaseSync) => void };

// Cuando subas SCHEMA_VERSION a 2, agrega aquí: { to: 2, up: (db) => { db.exec("ALTER TABLE ...") } }
const MIGRATIONS: Migration[] = [];

export function migrate(db: DatabaseSync): number {
  let current = getSchemaVersion(db);
  for (const m of MIGRATIONS.filter((x) => x.to > current).sort((a, b) => a.to - b.to)) {
    transaction(db, () => {
      m.up(db);
      db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(m.to);
    });
    current = m.to;
  }
  return current;
}

/** true si la DB está al día con el binario. La usa `amalia start` y `amalia doctor`. */
export function isSchemaCurrent(db: DatabaseSync): boolean {
  return getSchemaVersion(db) >= SCHEMA_VERSION;
}
```

**Acción:** crea `src/db/migrate.test.ts`:

```ts
import { test, expect } from "vitest";
import { openDb, applySchema } from "./index.js";
import { migrate, isSchemaCurrent } from "./migrate.js";

test("migrate no hace nada si ya está al día", () => {
  const db = openDb(":memory:");
  applySchema(db);
  expect(migrate(db)).toBe(1);
  expect(isSchemaCurrent(db)).toBe(true);
});
```

**Verificación:** `npm test` → todos los tests (db + migrate) pasan.

---

## Errores comunes a evitar

- **No** uses `better-sqlite3` ni `new Database()`. Es `import { DatabaseSync } from "node:sqlite"` y `new DatabaseSync(path)`.
- **No** uses `db.pragma(...)` (eso era de better-sqlite3): para fijar PRAGMAs usa `db.exec("PRAGMA ...")`; para leer un PRAGMA usa `db.prepare("PRAGMA x").get()`.
- **No** uses `db.transaction(...)` (no existe en node:sqlite): usa el helper `transaction(db, fn, immediate?)`.
- **No** olvides `.js` en los imports relativos (TypeScript con `module: ES2022` lo exige).
- **No** apliques `schema.sql` dos veces sobre la misma DB (fallará por tablas duplicadas). `applySchema` es solo para DB nueva.
- **No** pongas lógica de la API ni del CLI aquí; esta etapa es SOLO la capa de datos.

---

## Definición de Hecho (Etapa 1)

- [ ] `package.json`, `tsconfig.json`, `vitest.config.ts` creados.
- [ ] `npm install` corrió sin errores.
- [ ] `src/shared/types.ts` con los tipos y `SCHEMA_VERSION`.
- [ ] `src/db/schema.sql` con el DDL exacto.
- [ ] `src/db/index.ts` (`openDb`, `applySchema`, `getSchemaVersion`, `transaction`).
- [ ] `src/db/migrate.ts` (`migrate`, `isSchemaCurrent`).
- [ ] `npm run typecheck` pasa.
- [ ] `npm test` pasa (db.test.ts + migrate.test.ts en verde).
