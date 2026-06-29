# PLAN 00 — Índice Maestro de Desarrollo (Amalia)

> **Para el agente de IA que ejecuta este plan.** Lee este archivo COMPLETO antes de
> abrir cualquier otro `PLAN-0X-*.md`. Aquí están las decisiones técnicas que **no debes
> cambiar** y las reglas de cómo trabajar. Cada etapa tiene su propio archivo con tareas
> numeradas; haz **una tarea a la vez**, en orden, y no pases a la siguiente hasta que la
> verificación de la actual pase.

---

## 1. Qué se está construyendo

`amalia` es un **paquete npm** con un binario CLI (`amalia`) y un servicio (Orchestrator API)
que coordina varios agentes de IA ("bees") trabajando en `git worktree`. La fuente de verdad
es una base SQLite. La especificación funcional completa está en
[`ESPECIFICACION-ORQUESTADOR-MULTI-AGENTE.md`](ESPECIFICACION-ORQUESTADOR-MULTI-AGENTE.md).

**Regla de oro:** si este plan y la especificación se contradicen, **gana el plan**.
Si el plan no menciona un detalle, consulta la especificación. No inventes funcionalidad
que no esté en ninguno de los dos.

---

## 2. Orden de construcción (etapas)

Construye en este orden exacto. Cada etapa depende de las anteriores.

| Etapa | Archivo | Implementa (de la especificación) | Depende de |
|---|---|---|---|
| 1 | `PLAN-01-MODELO-DATOS.md` | Capa 0 — esquema SQLite + migraciones | — |
| 2 | `PLAN-02-ORCHESTRATOR-API.md` | Capa 1 — REST + WebSocket + jobs + seguridad | Etapa 1 |
| 3 | `PLAN-03-CLI-NPM.md` | CLI `amalia` + empaquetado npm (Fase 4 del roadmap) | Etapas 1, 2 |
| 4 | `PLAN-04-MOTORES.md` | Capa 3 — clientes/lanzadores de motores (Fase 2) | Etapas 2, 3 |
| 5 | `PLAN-05-DASHBOARD.md` | Capa 2 — dashboard web (Fase 3) | Etapa 2 |

> Nota: el roadmap de la especificación numera el CLI como "Fase 4", pero por dependencias
> de build lo construimos en la Etapa 3 (el CLI necesita la base de datos y la API ya hechas).

---

## 3. Decisiones técnicas FIJAS (no las cambies)

| Tema | Decisión | Motivo |
|---|---|---|
| Lenguaje | **TypeScript** (strict) | Tipado estático reduce errores |
| Runtime | **Node.js >= 24** (LTS) — requisito duro | `node:sqlite` es estable y sin flags desde Node 24 |
| Base de datos | **`node:sqlite`** (módulo integrado de Node) | **Sin compilación nativa** ni dependencia externa; evita el error de Visual Studio/C++ en Windows |
| Framework HTTP | **Express 4** | Muy documentado |
| WebSocket | **`socket.io` 4** | Lo pide la especificación |
| Validación de entrada | **`zod`** | Declarativo, mensajes claros |
| Parser de CLI | **`commander` 12** | Estándar para CLIs en Node |
| Hash de tokens | **`node:crypto` → SHA-256** | Tokens ya son aleatorios de alta entropía |
| IDs/tokens aleatorios | **`node:crypto` → `randomBytes`** | Sin dependencias extra |
| Tests | **`vitest`** | Rápido, sintaxis simple |
| Build | **`tsc`** → carpeta `dist/` | Sin bundlers complejos |
| Parseo de frontmatter YAML | **`gray-matter`** | Lee/escribe frontmatter de `.md` |
| Cliente HTTP (CLI→API) | **`fetch` nativo de Node** | Sin dependencias |

**No agregues otras librerías** sin que el plan lo indique. Si crees que falta una, detente
y reporta en vez de instalarla.

> **Sobre `node:sqlite`.** Es un módulo **integrado en Node** (no se instala con npm). Requiere
> **Node 24 o superior**, donde es estable y se usa **sin flags**. Verifica tu versión con
> `node --version`: si es menor que 24, **actualiza Node antes de empezar** (no hay forma de
> usar `node:sqlite` en Node 20). En Windows, descarga el instalador de Node 24 LTS desde
> nodejs.org, o usa `nvm-windows` (`nvm install 24 && nvm use 24`).

---

## 4. Estructura del repositorio (la creas en la Etapa 1)

Todo el código del paquete vive en este repositorio. Estructura final esperada:

```
.
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bin/
│   └── amalia.js                 # entrypoint del CLI (apunta a dist/cli/index.js)
├── src/
│   ├── db/                       # Etapa 1 — Capa 0
│   │   ├── schema.sql            # DDL completo
│   │   ├── migrations/           # migraciones incrementales
│   │   └── index.ts              # apertura de la DB, PRAGMAs, helpers
│   ├── api/                      # Etapa 2 — Capa 1
│   │   ├── server.ts             # crea app Express + socket.io
│   │   ├── routes/               # una ruta por archivo
│   │   ├── jobs/                 # job de mantenimiento, watchdog, retención
│   │   ├── auth.ts               # tokens, middleware de autenticación
│   │   ├── events.ts             # emisión de eventos + WebSocket
│   │   └── validation.ts         # esquemas zod
│   ├── cli/                      # Etapa 3 — CLI
│   │   ├── index.ts              # registra comandos con commander
│   │   └── commands/             # un comando por archivo
│   ├── engines/                  # Etapa 4 — Capa 3
│   │   └── ...
│   └── shared/                   # tipos y utilidades compartidas
│       └── types.ts
├── dashboard/                    # Etapa 5 — Capa 2 (cliente web estático)
├── templates/                    # plantillas que copia `amalia hatch`/`init`
│   ├── AGENTS.md
│   ├── bee.md
│   └── tasks/
└── test/                         # tests de integración (los unitarios van junto al código)
```

---

## 5. Convenciones de código (obligatorias)

1. **TypeScript strict**: `tsconfig.json` con `"strict": true`. Cero `any` salvo que el plan lo permita explícitamente.
2. **Sin lógica de negocio en las rutas**: las rutas validan entrada (zod), llaman a una función de servicio, y devuelven JSON. La lógica vive en módulos de `src/db` o `src/api/*service.ts`.
3. **Toda escritura a la DB pasa por la Capa 1.** Nunca abras la DB desde el CLI directamente para escribir; el CLI llama a la API por HTTP. (Excepción: `amalia init` crea el archivo `.db` y aplica el esquema, porque la API aún no existe.)
4. **Git siempre con argumentos en array**: usa `execFile`/`spawn` de `node:child_process`, **nunca** `exec` con string. Ningún valor del usuario se interpola en una shell.
5. **Validar nombres y rutas** antes de tocar el filesystem (ver reglas de seguridad de cada etapa).
6. **Mensajes de error claros en español** para el usuario final del CLI; logs internos en inglés está bien.
7. **Nombres**: archivos en `kebab-case.ts`, funciones/variables en `camelCase`, tipos/clases en `PascalCase`, constantes en `UPPER_SNAKE_CASE`.

---

## 6. Cómo trabajar en cada tarea (protocolo)

Para CADA tarea numerada de un `PLAN-0X`:

1. **Lee** la tarea completa antes de escribir código.
2. **Crea o edita** solo los archivos que la tarea menciona.
3. **Escribe el test** que la tarea pide (si pide uno).
4. **Ejecuta la verificación** indicada (comando + salida esperada).
5. Si la verificación **falla**, corrige y repite. No avances con tests rojos.
6. Si algo es **ambiguo o imposible**, **detente y reporta** con: qué tarea, qué esperabas, qué pasó. No improvises arquitectura.

**Comandos base** (se asume que ya corriste `npm install`):

```bash
npm run build      # tsc -> dist/
npm test           # vitest run
npm run typecheck  # tsc --noEmit
```

---

## 7. Definición de "Hecho" global

Una etapa está terminada cuando:

- [ ] Todos los archivos listados en su `PLAN-0X` existen.
- [ ] `npm run typecheck` pasa sin errores.
- [ ] `npm test` pasa (todos los tests de la etapa en verde).
- [ ] Los criterios de verificación de cada tarea pasaron.
- [ ] El checklist "Definición de Hecho" al final del `PLAN-0X` está completo.

No marques una etapa como hecha si algo de lo anterior falla.
