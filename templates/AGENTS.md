# Amalia — Integration Worktree

This central worktree receives the integrated work from all bees.

## Convention

- Each bee works in its own worktree inside `honeycomb/<bee>/`.
- Integrations are done via `git merge --no-ff` from the bee's branch.
- Use the `Amalia-Task: TASK-XX` trailer in commits to track coverage.
