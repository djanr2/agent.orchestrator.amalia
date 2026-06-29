# PLAN 05 — Etapa 5: Dashboard Web (Capa 2)

> Lee primero [`PLAN-00-INDICE.md`](PLAN-00-INDICE.md) y termina la Etapa 2 (la API).

## Objetivo

Construir el **dashboard web** que consume exclusivamente la API/WebSocket de la Capa 1, para
que un humano supervise y opere el enjambre: bees activos, cola de tareas, detalle de tarea +
resultados, y creación manual de tareas.

## Prerrequisitos

- Etapa 2 completa (API REST + WebSocket funcionando).

## Decisiones ya tomadas (no las cambies)

- Stack: **HTML + JavaScript vanilla** (sin framework), servido como estático desde
  `<panal>/dashboard/`. Es lo más simple de mantener y suficiente para Fase 1.
- El dashboard **no incrusta el token de operador** en el bundle: se carga desde un campo de
  login local que se guarda solo en memoria de la sesión del navegador (ver especificación →
  Seguridad → "El dashboard no incrusta el token de operador").
- Se conecta al WebSocket con el token en `auth` del handshake.

---

## Tarea 5.1 — Estructura estática

**Acción:** crea en `dashboard/`:
- `index.html` — layout con 3 zonas: panel de bees, cola de tareas, panel de detalle.
- `app.js` — lógica (fetch + socket.io-client por CDN o copia local).
- `styles.css` — estilos mínimos legibles.

**Acción:** la API (Etapa 2) debe servir esta carpeta como estática en una ruta, p. ej.
`GET /` → `dashboard/index.html` (usa `express.static`). Añade esa línea al `server.ts`.

**Verificación:** con `amalia start`, abrir `http://127.0.0.1:4000/` muestra el `index.html`.

---

## Tarea 5.2 — Login local y conexión

**Acción:** en `app.js`:
- Un campo para pegar el **token de operador**; se guarda en una variable JS (no en `localStorage`).
- Función `api(path, opts)` que añade `Authorization: Bearer <token>` a cada `fetch`.
- Conexión socket.io: `io({ auth: { token } })`. Si el handshake es rechazado, mostrar
  "token inválido".

**Verificación:** con token válido, la conexión WS se establece (ver consola); con token
inválido, se rechaza.

---

## Tarea 5.3 — Panel de bees

**Acción:** lista de bees con `GET /bees`: nombre, **motor visible** (Claude Code, opencode,
Ollama...), estado (`idle/busy/offline`), último heartbeat, tarea actual. Refresco en vivo con
los eventos `bee:registered`, `bee:heartbeat`, `bee:offline`.

**Verificación:** al hacer heartbeat un bee (vía API), su fila se actualiza sin recargar.

---

## Tarea 5.4 — Cola de tareas + detalle

**Acción:**
- Tabla de tareas con `GET /tasks`, filtros por `status` y por `bee`.
- Refresco en vivo con `task:created` y `task:status_changed`.
- Al hacer clic en una tarea: panel de detalle con su estado, lock, dependencias, `block_reason`,
  e historial de **resultados** (de la tabla `results`, vía la API).

**Verificación:** crear una tarea desde otra vía (CLI/API) la hace aparecer en la tabla en vivo.

---

## Tarea 5.5 — Crear tarea desde la UI

**Acción:** formulario que hace `POST /tasks` (token operador): bee destino, descripción,
prioridad, dependencias. Validar en cliente lo mínimo (campos requeridos); la validación fuerte
es del servidor.

**Verificación:** crear una tarea desde el formulario aparece en la cola y en la DB.

---

## Tarea 5.6 — Visibilidad de conflictos

**Acción:** mostrar de forma destacada los eventos `integration:conflict`, `reconcile:conflict`
y `update:conflict` (un banner o lista de "inconsistencias que requieren intervención humana"),
ya que la resolución es responsabilidad del programador.

**Verificación:** emitir un `integration:conflict` (vía API de prueba) muestra el aviso.

---

## Errores comunes a evitar

- **No** guardes el token en `localStorage` ni lo dejes en el HTML/JS servido.
- **No** dupliques lógica de negocio en el cliente: el dashboard solo lee/escribe vía la API.
- **No** asumas auto-refresh por polling agresivo: usa el WebSocket; el polling es solo respaldo.

---

## Definición de Hecho (Etapa 5)

- [ ] `dashboard/index.html`, `app.js`, `styles.css` creados.
- [ ] La API sirve el dashboard como estático.
- [ ] Login local con token (no persistido) + conexión WS autenticada.
- [ ] Panel de bees, cola de tareas con filtros, detalle + resultados, alta de tareas.
- [ ] Avisos de conflictos en vivo.
- [ ] Refresco en tiempo real por WebSocket verificado.
