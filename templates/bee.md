# Bee: {{name}}

- **Role:** {{role}}
- **Worktree:** `honeycomb/{{name}}/`

## Engine

- **Engine:** {{engine}}
- **Connection mode:** {{connection_mode}}
- **Model:** {{model}}
- **Start command:** {{start_command}}
- **Endpoint:** {{endpoint}}
- **Auth env var:** {{auth_env}}

## Orchestrator API Connection

- **Name:** {{name}}
- **API URL:** {{api_base_url}}
- **Heartbeat (seconds):** {{heartbeat_seconds}}

## Working Convention

1. Read `tasks/tasks.md` to see assigned tasks.
2. Each task has its own `tasks/<slug>.task.md` file with metadata and description.
3. When completing a task, include the `Amalia-Task: TASK-XX` trailer in the commit.
4. Report results via `POST /api/orchestrator/tasks/<code>/results`.
