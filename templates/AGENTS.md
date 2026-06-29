# Amalia — Worktree de Integración

Este worktree central recibe el trabajo integrado de todos los bees.

## Convención

- Cada bee trabaja en su propio worktree dentro de `honeycomb/<bee>/`.
- Las integraciones se hacen via `git merge --no-ff` desde la rama del bee.
- Usar el trailer `Amalia-Task: TASK-XX` en los commits para rastrear cobertura.
