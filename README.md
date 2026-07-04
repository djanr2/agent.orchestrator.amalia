# Amalia

```
00000000000000000000000000000000000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000 "000000000000000000000000000000000000000
000000000000000000000000000000000000000  000000000000000000000000000000000000000
0000000000000000000000000000000@M00000X  #0000M700000000000000000000000000000000
0000000000000000000000000MM0000&_ `~~^ jg ~~~` y000000M0000000000000000000000000
0000000000000000000000F  __  ~@00g \gg000#pg- p00M`  __  #0000000000000000000000
0000000000000000000000 ]000MQg_ ~0g R000000' j@^ ,g0M000  0000000000000000000000
0000000000000000000000&_``_p000&_ Mg `    ` 0' ,M000,`` _00000000000000000000000
000000000000000000000000000000000g ^NN000Mp0^ p000000000000000000000000000000000
0000000000000000000000000000000000g ]000000^ p0000000000000000000000000000000000
00000M~~``     ``~~MM00000000000'j0p Q0000f j06]00000000000M@~~``     `~~MM00000
00M^ _pppgMMMM0Npgp_  `MM000000!_000  0000 w000 B000000M~`  _pgggMMM00ggg,  ~000
0X pM0000000000000000#g,  ~0000 ]000L #008 4000c]000M~  pgM0000000000000000N, M0
# q0000000000000000000000g, ~00 4000& B00& 4000c 0M^ pN0000000000000000000000c 0
0  000000000000000000000000&, M  000  000# ]000 ]5 g#000000000000000000000000 _0
0& ^Q000000000000000000000000NM&  ~  p0000g `^  #N0000000000000000000000000M  #0
00&, ~M00000000M@MMMM@M000000000&  *00000000n _#000000000@MMMM@MM00000000M^ _000
0000&g_ `~9~`  _,,ggg,, ~000000@j&, ^M0000@^ g0CM000000  _,gpg,__  `~M~` _g00000
00000000  __      `    _g000008j000Ng_    _p0000p000000g    ``     __  =00000000
000000F _g00000M&Ngg0000000000 00000000000000000# 00000000M0NgM0000000g  Q000000
00000F g000000000000000000000L    `~~MM@F9~~~`    ]000000000000000000000, 000000
000006 000000000000000000MMN0 q,_              _pp"0NM000000000000000000& ]00000
000001 R00000000000000MMLN000 #000MMgggpgpgNM0000f 000&_M000000000000000! Z00000
000000g  ~MM00000M@~`_g000000  ~@M00000000000MMM^  00000Mg_~~MMM0000MM~  p000000
00000000gg__   __,pg000000000n                    ]000000000pg,_______pg00000000
00000000000000000000000000000& qpg___     ___,pgc B00000000000000000000000000000
000000000000000000000000000000 "0000000000000000  000000000000000000000000000000
000000000000000000000000000000g   ~~~@MM@@M~~^   #000000000000000000000000000000
0000000000000000000000000000000,                j0000000000000000000000000000000
00000000000000000000000000000000  0ggggppggg0F _00000000000000000000000000000000
00000000000000000000000000000000&_ #00000000F _000000000MMMMMMMMMMMMMMMM00000000
000000000000000000#~00000000000000,          y0000C`  #1 jMg            00000000
000000000000000000^ 400000000000000g       _g000000I  #1 "0!            00000000
00000000000000000Y   0000000000000000NggpgM00000000I  #1   _     __     00000000
00000000000000000 #  ]000C~` ~_  ~~_  ~000~__  ~000I  #1"00#   M@M00g   00000000
0000000000000000']0c  00001  #0&  #0&  ]000000  ]00I  #1 ]0#      ]00   00000000
000000000000000F ```  ]0001  00#  400  ]00M~~~  ]00I  #1 ]0#  _ggMM00   00000000
000000000000000 j000f  0001  00#  400  ]0f  00  ]00I  #1 ]0#  006  00   00000000
00000000000000f 0000&  `001  #0#  400  ]0Y  MM  ]00I  #1 ]0#  Q0&gJ00_  00000000
0000000000000&ggg00#gggggggggg#gggg0ggggg0pgggbgggNggggp,,,,,,,,,,,,,,,,00000000
00000000000000000000000000000000000000000000000000000000000000000000000000000000
```

**Multi-agent orchestrator over git worktrees.**

Amalia coordinates multiple AI agents (Claude Code, OpenCode, Ollama) working in parallel on the same repository, each isolated inside its own git worktree. Tasks are assigned via the CLI or API, each agent ("bee") claims its own, executes them, reports results, and the work is integrated back into a central branch called `amalia`.

## What Amalia gives you

- **Per-worktree isolation.** Each bee lives in `honeycomb/<bee>/` with its own branch (`bee/<name>`). No conflicts from shared branches or working directories stepping on each other.
- **Persistent task queue.** Local SQLite (`honeycomb/orchestrator-api/amalia.db`) with `bees`, `tasks`, `task_dependencies`, `results`, `integrations` and `events`. Supports priorities, retries, dependencies, leases and optimistic concurrency control (`rev`).
- **HTTP API + WebSocket.** Express server on `:4000` with bearer token authentication (`Bearer <token>` per bee) and real-time events over Socket.IO for the dashboard.
- **Web dashboard.** Served at `http://127.0.0.1:4000/` to observe bees, tasks and events without depending on the CLI.
- **File-based replica.** Every task is also written as `tasks/<slug>.task.md` with frontmatter inside the bee's worktree, so the agent can read instructions without hitting the API.
- **Engine adapters.** `claude-code`, `opencode` and `ollama`, all configurable from `bee.md` (`engine`, `model`, `start_command`).
- **Git-based integration.** A bee's work is integrated into the `amalia` branch via `merge --no-ff` or `cherry-pick`, using the `Amalia-Task: TASK-XX` trailer for traceability.
- **Safe recovery.** `init` rolls back if anything fails, `doctor` diagnoses and auto-repairs `.gitignore` and schema migrations, `kill` refuses to remove bees with unintegrated work unless `--force` is passed.
- **The Queen is untouchable.** The `amalia` bee cannot be removed with `kill`.

## Requirements

- Node.js **>= 20** (24 recommended)
- Git **>= 2.5** (worktree support)
- Must be run inside a git repository

## Installation

```bash
npm install
npm run build
npm link   # optional, to expose `amalia` globally
```

## Typical lifecycle

```bash
amalia init                                     # create the hive
amalia start -d                                 # start the API in the background
amalia hatch database-bee --engine claude-code  # create a bee
amalia task add database-bee "Migrate schema X" # assign it a task
amalia run database-bee                         # bee claims and executes
amalia check                                    # observe status
amalia integrate merge database-bee             # integrate its work into amalia
amalia stop                                     # shut the API down
```

## Commands

Every command can be run from any directory inside the repo: Amalia locates the hive by walking up until it finds `.amalia-root`.

### `amalia init`

Initializes a new hive in the current repository.

- Checks Git >= 2.5, Node >= 20, and that you are inside a worktree.
- Creates `honeycomb/`, `honeycomb/orchestrator-api/`, `honeycomb/.secrets/`, `honeycomb/dashboard/`.
- Creates the SQLite database and applies the schema.
- Generates the operator token (stored in `.secrets/amalia.token`, mode 600).
- Creates the `honeycomb/amalia/` worktree on the current branch and renders `AGENTS.md` + `bee.md` + `tasks/`.
- Inserts the `amalia` bee into the DB, writes `.amalia-root` and appends the `.gitignore` block.
- **Full rollback** if anything fails midway.

Options:
- `--honeycomb-path <path>` — hive path (default: `honeycomb`).

### `amalia start`

Starts the orchestrator API server.

- Validates that the schema version matches the code (suggests `amalia doctor` otherwise).
- Boots Express + Socket.IO and the jobs scheduler.
- Serves the static dashboard if `dashboard/` exists.
- Writes `api.pid` so `amalia stop` can find it.
- Prints the operator token and a clickable URL (OSC 8).

Options:
- `-p, --port <port>` — port (default: `4000`, env `AMALIA_PORT`).
- `-d, --detach` — runs in the background and frees the terminal (logs at `honeycomb/orchestrator-api/api.log`).

### `amalia stop`

Stops the server started with `start`. Reads `api.pid`, sends `SIGTERM`, and deletes the PID file.

### `amalia hatch <name>`

Creates a new bee in the hive.

- Validates that the name matches the `<something>-bee` pattern.
- Inserts the bee into the DB, generates its token (`.secrets/<name>.token`, mode 600).
- Creates the `honeycomb/<name>/` worktree on the `bee/<name>` branch.
- Renders `bee.md` + `AGENTS.md` + `tasks/tasks.md` + `tasks/results.md` with default `engine`, `model` and `start_command` for the chosen engine.
- **Full rollback** if worktree creation fails.

Arguments:
- `<name>` — bee name (e.g. `database-bee`).

Options:
- `--engine <engine>` — engine to use (`opencode`, `claude-code`, `ollama`). Default: `opencode`.
- `--branch <branch>` — worktree branch (default: `bee/<name>`).
- `--role <role>` — free-form description of the bee's role.

### `amalia kill <name>`

Removes a bee from the hive: DB row, token, worktree and branch.

- Rejects `amalia` (the Queen is off-limits).
- If the bee has `pending` or `in_progress` tasks, requires `--force` or `--reassign-to`.
- If its branch has commits not yet in `target_branch`, requires `--force`.
- Reassigning moves **all** of the bee's tasks to the target (to avoid breaking the FK constraint).

Options:
- `--force` — remove even if there is pending work or unintegrated commits.
- `--reassign-to <bee>` — transfer tasks to another bee before removal.

### `amalia run <bee>`

Launches the bee's runtime: claims pending tasks from the API and runs them with the engine configured in its `bee.md`.

- Checks that the bee's worktree and token exist.
- Runs as a daemon loop unless `--once` is passed.
- Closes fetch sockets on exit in `--once` mode so the process doesn't hang.

Options:
- `--once` — runs a single *claim → execute → report* cycle and exits.

### `amalia task`

Task management against the API. Requires the server to be running.

#### `amalia task add <bee> <description>`

Creates a task and updates the bee's local files.

- Computes the `slug` from the description (or from `--slug` if given).
- Registers dependencies by code (`TASK-XX`).
- Writes `tasks/<slug>.task.md` and refreshes the bee's `tasks/tasks.md` summary.

Options:
- `--priority <priority>` — `high`, `medium`, `low` (default: `medium`).
- `--depends-on <codes>` — comma-separated codes of prerequisite tasks.
- `--slug <slug>` — override the auto-generated slug.

#### `amalia task list`

Lists tasks with optional filters.

Options:
- `--status <status>` — filter by status.
- `--bee <bee>` — filter by assigned bee.

#### `amalia task retry <code>`

Moves a `blocked` or `failed` task back to `pending`, resetting the attempt counter.

#### `amalia task show <code>`

Shows a task's detail (code, slug, status, priority, assignment, description, `rev`, `block_reason`).

### `amalia check [bee]`

Shows bee and task status. If the API is alive it queries it; otherwise it falls back to reading the local worktrees and counting `.task.md` files.

Arguments:
- `[bee]` — optional, filter by a specific bee.

### `amalia logs <bee>`

Shows the bee's recent events (last 20) from the API. If the API is unreachable, prints the bee's local `tasks/results.md`.

### `amalia update`

Updates the `amalia` worktree against `target_branch`.

- Detects if the repo's branch changed and syncs `.amalia-root`.
- `git fetch` + `git rebase` on top of the target branch.
- If there are conflicts, aborts the rebase automatically and asks you to run `amalia integrate`.

### `amalia integrate`

Integrates a bee's work into the `amalia` worktree. Requires a clean Amalia worktree.

#### `amalia integrate merge <bee>`

`git merge --no-ff bee/<name>` on `honeycomb/amalia/`. On conflict, prompts you to resolve manually.

#### `amalia integrate cherry-pick <bee> <sha>`

`git cherry-pick <sha>` on `honeycomb/amalia/`. The SHA is validated before running.

### `amalia sync`

Reconciles local `tasks/<slug>.task.md` files with the database.

- Downloads tasks from the API and groups them by bee.
- If a local file's `rev` is lower than the DB's, rewrites it.
- If the local `rev` is higher than the DB's, prints a conflict warning (does not overwrite).

### `amalia doctor`

Diagnoses and repairs the hive.

- Checks Git, that you are inside a repo, current branch.
- Verifies the Amalia `.gitignore` block and re-inserts it if missing.
- Verifies the DB's existence and schema version, running `migrate` if out of date.
- Verifies that the `amalia` worktree exists.
- Exits non-zero if any check could not be repaired.

## Supported engines

Each bee is configured by editing its `honeycomb/<bee>/bee.md` file. The runtime (`amalia run <bee>`) reads the `## Engine` and `## Orchestrator API Connection` sections, using the `- **Key:** value` format.

The three adapters share:
- **Fixed prompt**: `description + acceptance criteria`, plus an instruction to "write your question at the end if you need clarification" for claude/opencode.
- **Injected env vars**: `AMALIA_TASK_CODE` and `AMALIA_BEE_NAME`. If you set `Auth env var`, Amalia forwards that variable from the operator's environment into the bee process (useful for `ANTHROPIC_API_KEY`, etc.).
- **`start_command` does not support quoting**: it is split naively on whitespace. If you need quotes or pipes, put the command in a wrapper script and point at that instead.

### Claude Code (`claude-code`)

Runs the `claude` CLI locally and passes the prompt as the last positional argument.

- **Default command**: `claude -p --allowedTools Read,Edit,Write,Bash --permission-mode acceptEdits`
- **Default model**: `claude-sonnet-4-6` (injected as `--model <model>` if not already present in `start_command`).
- **Requirements**: `claude` on `PATH` and authentication (typically `ANTHROPIC_API_KEY` or a prior OAuth login).
- **Timeout**: 5 minutes per task, 10 MB output buffer.
- **Windows**: npm `.cmd` shims are resolved directly to the `.exe` (or the `node <script>` behind them) so we never go through `cmd.exe`, avoiding shell injection.

Example `bee.md`:

```md
## Engine

- **Engine:** claude-code
- **Connection mode:** cli
- **Model:** claude-sonnet-4-6
- **Start command:** claude -p --allowedTools Read,Edit,Write,Bash --permission-mode acceptEdits
- **Endpoint:**
- **Auth env var:** ANTHROPIC_API_KEY
```

Create the bee: `amalia hatch backend-bee --engine claude-code`.

### OpenCode (`opencode`)

Shares the `claude-code` adapter (same `execFile` flow + positional prompt), with two key differences.

- **Default command**: `opencode run --auto`
- **Default model**: `opencode/big-pickle` (also injected as `--model <model>`).
- **Key peculiarity**: `--dir <beeDir>` is added automatically because `opencode run` **does not** inherit `cwd` from the parent process the way `claude` does. If your `start_command` already includes `--dir`, Amalia respects yours.

Example `bee.md`:

```md
## Engine

- **Engine:** opencode
- **Connection mode:** cli
- **Model:** opencode/big-pickle
- **Start command:** opencode run --auto
- **Endpoint:**
- **Auth env var:**
```

Create the bee: `amalia hatch frontend-bee --engine opencode`. This is the default engine for `hatch`.

### Ollama (`ollama`)

**Does not run a CLI**: it POSTs HTTP requests to the Ollama API. This has strong implications.

- **Default endpoint**: `http://localhost:11434/api/generate` (override with the `Endpoint` field in `bee.md`).
- **Default model**: `llama3`. Sent in the request body, **not** as a flag.
- **`Start command` is ignored**: there is no local process to spawn.
- **`stream: false`**: waits for the full response before closing.
- **Key limitation**: Ollama returns plain text. The adapter stores that text in the result's `notes`, but **does not modify files** or run commands on its own. It works as a consultant / proposal-generating agent, not as an autonomous editor. To automate edits from the model's output, you have to wire that in externally.

Example `bee.md`:

```md
## Engine

- **Engine:** ollama
- **Connection mode:** cli
- **Model:** llama3
- **Start command:**
- **Endpoint:** http://localhost:11434/api/generate
- **Auth env var:**
```

Create the bee: `amalia hatch reviewer-bee --engine ollama`.

## Directory layout

```
<repo>/
├── .amalia-root                        # hive marker (JSON config)
└── honeycomb/
    ├── amalia/                         # integration worktree
    ├── <bee>/                          # one worktree per bee
    │   ├── bee.md                      # bee config (engine, model, endpoint)
    │   ├── AGENTS.md
    │   └── tasks/
    │       ├── tasks.md                # human-readable summary
    │       ├── results.md
    │       └── <slug>.task.md          # one file per task (frontmatter)
    ├── orchestrator-api/
    │   ├── amalia.db                   # SQLite
    │   ├── api.pid
    │   └── api.log
    ├── .secrets/
    │   ├── amalia.token                # operator token
    │   └── <bee>.token                 # one token per bee
    └── dashboard/
```

## Authentication

Every API request carries `Authorization: Bearer <token>`. Each bee has its own token; the `amalia` token is the operator's and has full permissions. Tokens are stored hashed in the DB (`token_hash`) and in clear text under `.secrets/` with mode 600.

## License

MIT.
