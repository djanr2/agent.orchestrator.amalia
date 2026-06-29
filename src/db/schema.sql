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
