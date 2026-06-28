# Manual: Publicar Amalia en npm

Esta guía no forma parte de la arquitectura del sistema (ver [ESPECIFICACION-ORQUESTADOR-MULTI-AGENTE.md](ESPECIFICACION-ORQUESTADOR-MULTI-AGENTE.md)) — es el procedimiento operativo para distribuir el paquete `amalia` en npm, de modo que cualquier repositorio Git pueda instalarlo y ejecutar `amalia init`.

## 1. Preparar la cuenta

1. Crear cuenta en [npmjs.com](https://www.npmjs.com/signup) si no se tiene una.
2. En la terminal: `npm login` (pide usuario, contraseña y, si hay 2FA, el código OTP).
3. Verificar la sesión: `npm whoami`.

## 2. Verificar el nombre del paquete

1. Antes de nada, comprobar que `amalia` esté libre: `npm view amalia` (un 404 significa que está libre).
2. Si está tomado, usar un scope (`@tu-usuario/amalia` o `@amalia-cli/core`) — es gratis y evita colisiones de nombre.

## 3. Estructura mínima del `package.json`

```json
{
  "name": "amalia",
  "version": "0.1.0",
  "description": "Orquestador multi-agente para repositorios Git",
  "bin": {
    "amalia": "./bin/amalia.js"
  },
  "main": "./dist/index.js",
  "files": ["dist", "bin", "templates"],
  "engines": { "node": ">=18" },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/<usuario>/<repo>.git"
  }
}
```

- `bin` es lo que registra el comando `amalia` globalmente al instalar.
- `files` controla qué se sube al paquete (evita subir código fuente sin compilar, tests, marcadores `.amalia-root` de prueba, etc.) — más preciso que depender solo de `.gitignore`.
- El archivo apuntado por `bin` debe empezar con `#!/usr/bin/env node`.

## 4. Compilar (si se usa TypeScript)

Ejecutar `npm run build` (o el script que compile TS → `dist/`) antes de publicar. Lo ideal es automatizarlo con el hook `prepublishOnly`:

```json
"scripts": { "prepublishOnly": "npm run build" }
```

## 5. Probar localmente antes de publicar

- `npm pack` — genera el `.tgz` exacto que se subiría, para revisar su contenido sin publicarlo.
- `npm link` (desde la carpeta del paquete) y luego `amalia init` en otro repo de prueba, para confirmar que el binario funciona como se espera una vez "instalado".

## 6. Publicar

- Paquete público sin scope: `npm publish`
- Paquete con scope (`@tu-usuario/amalia`) y público: `npm publish --access public` (los scoped quedan privados por defecto, lo que requiere plan de pago).

## 7. Versionado para futuras actualizaciones

- Usar `npm version patch|minor|major` (actualiza `package.json` y crea un tag git) antes de cada `npm publish` nuevo.
- Seguir semver: parches para fixes, minor para nuevos comandos del CLI (`hatch`, `integrate`, etc.) sin romper compatibilidad, major si cambia el esquema de `amalia.db` o el formato de `bee.md`/`AGENTS.md` de forma incompatible.

## 8. Una vez publicado

- Cualquiera puede instalarlo con `npm install -g amalia` o ejecutarlo sin instalar con `npx amalia init`, tal como se describe en la especificación de arquitectura.
- Mantener un `CHANGELOG.md` ayuda, sobre todo porque cambios en el esquema SQLite o en `bee.md` pueden requerir migración manual en proyectos que ya usan Amalia.
