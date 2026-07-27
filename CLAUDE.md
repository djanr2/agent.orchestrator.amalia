# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # tsc -> dist/ + copies src/db/schema.sql to dist/db/
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run test:watch
npx vitest run src/api/tasks.service.test.ts        # single file
npx vitest run -t "claims a pending task"           # single test by name
```

There is no linter or formatter configured. `bin/amalia.js` imports `dist/`, so the CLI
must be rebuilt (`npm run build`) before manual end-to-end testing; `npm link` exposes it globally.

Tests live both next to sources (`src/**/*.test.ts`) and in `test/` (integration-flavored:
`init`, `hatch-kill`, `api`, `engines`). Both globs are in `vitest.config.ts`; `tsconfig.json`
excludes `test/` from the build.

Requires Node >= 24 — the DB layer uses the built-in `node:sqlite` (`DatabaseSync`), not a
third-party driver. There is no ORM; all SQL is hand-written.

## Architecture

Amalia is a CLI + local HTTP API that orchestrates several AI coding agents ("bees"), each
confined to its own git worktree, against a single repository. See `README.md` for the full
command/flag reference and engine configuration examples.

Four layers, meant to be understood in this order:

**1. Hive layout & discovery (`src/cli/config.ts`).** A hive is marked by a `.amalia-root`
file (simple `key: value` text) at the repo root. Every command calls `findRoot()` which walks
up from cwd, so commands work from anywhere inside the repo. All paths derive from that root:
`honeycomb/<bee>/` worktrees, `honeycomb/orchestrator-api/{amalia.db,api.pid,api.log}`, and
`honeycomb/orchestrator-api/.secrets/<bee>.token` (mode 600). Never hardcode these — use the
`honeycombDir` / `beeWorktree` / `secretsDir` / `dbPath` helpers.

**2. Persistence (`src/db/`, `src/api/*.service.ts`).** SQLite is the source of truth.
`schema.sql` is applied wholesale on `init`; after that, changes must go through a numbered
migration appended to `MIGRATIONS` in `src/db/migrate.ts` **and** a bump of `SCHEMA_VERSION`
in `src/shared/types.ts`. `amalia start` refuses to boot on a version mismatch and points at
`amalia doctor`, which runs the migrations. Concurrency rules that the services enforce and
tests depend on: tasks carry a `rev` for optimistic concurrency, claiming takes a lease
(`locked_by`, `locked_by_instance`, `lease_expires_at`) inside a `BEGIN IMMEDIATE`
transaction, and `task_dependencies` edges are cycle-checked (`wouldCreateCycle`) before
insert. Completion/failure cascade through `unblockDependents` / `propagateFailure`.

**3. API (`src/api/`).** Express router mounted at `/api/orchestrator` plus Socket.IO for
dashboard events. Auth is bearer-token on every route and on the socket handshake: tokens are
stored hashed in `bees.token_hash`, resolved by `identifyByToken`; the `amalia` bee's token is
the operator token and `requireOperator` gates task creation, status changes and integrations.
Route handlers are thin — validation (zod, `src/api/validation.ts`) and business logic belong
in `tasks.service.ts` / `bees.service.ts`, which also emit events via the injected `io`.
Background leases/cleanup live in `src/api/jobs/`.

**4. Bee runtime & engines (`src/engines/`).** `amalia run <bee>` → `launch.ts` picks an
adapter from the `ADAPTERS` map by the `engine` key parsed out of the bee's `bee.md`
(`bee-config.ts` reads `- **Key:** value` lines), then `bee-runtime.ts` runs the
register → heartbeat → claim → execute → report loop (`--once` for a single cycle; it falls
back to a degraded no-API mode if registration fails). Adapters implement the small
`EngineAdapter` interface in `adapters/index.ts`. `claude-code.ts` backs claude-code,
opencode, copilot-cli and codex-cli — it spawns a CLI via `execFile` with the prompt as the
last positional arg, so any per-engine quirk (opencode's mandatory `--dir`, model injection,
Windows `.cmd` shim resolution) is a branch inside that one adapter. `ollama.ts` is HTTP-only
and cannot edit files; it records the model's text in the result notes.

**File replica (`src/cli/replica.ts`).** Every task is mirrored into the bee's worktree as
`tasks/<slug>.task.md` with frontmatter (plus rolled-up `tasks.md` / `results.md`) so an agent
can work without calling the API. This is a *replica*, not a second source of truth: `rev`
decides. `amalia sync` rewrites files whose `rev` is behind the DB and only warns (never
overwrites) when the local `rev` is ahead. Any code path that mutates a task must also refresh
the replica, or `sync`/`check` will drift.

## Conventions

- ESM throughout (`"type": "module"`): relative imports must carry the `.js` extension even in `.ts` sources.
- Git operations go through the wrappers in `src/cli/git.ts` (which return `GitResult` rather than throwing) — don't shell out to git directly from commands.
- Destructive commands are expected to roll back fully on failure (`init`, `hatch`) and to refuse dangerous states without `--force` (`kill` on unintegrated work; the `amalia` bee can never be killed).
- Integration commits carry an `Amalia-Task: TASK-XX` trailer for traceability.
- Commit messages in this repo are written in Spanish and prefixed with the date: `2026.07.03: Descripción del cambio`.
