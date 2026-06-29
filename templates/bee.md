# Bee: {{name}}

- **Engine:** {{engine}}
- **Rol:** {{role}}
- **Worktree:** `honeycomb/{{name}}/`

## Convención de Trabajo

1. Lee `tasks/tasks.md` para ver las tareas asignadas.
2. Cada tarea tiene su archivo `tasks/<slug>.task.md` con metadatos y descripción.
3. Al completar una tarea, incluye el trailer `Amalia-Task: TASK-XX` en el commit.
4. Reporta resultados via `POST /api/orchestrator/tasks/<code>/results`.
