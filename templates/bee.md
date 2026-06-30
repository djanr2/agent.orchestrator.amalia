# Bee: {{name}}

- **Rol:** {{role}}
- **Worktree:** `honeycomb/{{name}}/`

## Motor

- **Motor:** {{engine}}
- **Modo de conexión:** {{modo_conexion}}
- **Modelo:** {{modelo}}
- **Comando de arranque:** {{comando_arranque}}
- **Endpoint:** {{endpoint}}
- **Variable de entorno (auth):** {{auth_env}}

## Conexión al Orchestrator API

- **Nombre:** {{name}}
- **URL de la API:** {{api_base_url}}
- **Heartbeat (segundos):** {{heartbeat_segundos}}

## Convención de Trabajo

1. Lee `tasks/tasks.md` para ver las tareas asignadas.
2. Cada tarea tiene su archivo `tasks/<slug>.task.md` con metadatos y descripción.
3. Al completar una tarea, incluye el trailer `Amalia-Task: TASK-XX` en el commit.
4. Reporta resultados via `POST /api/orchestrator/tasks/<code>/results`.
