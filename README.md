# App CPE

Aplicacion para consultar las puertas de turno y la distancia dentro del censo de fijos.

## Ejecutar la app

```powershell
npm install
npm run dev -- --port 5177
```

Abrir `http://127.0.0.1:5177/`.

## Uso

1. Entra con una chapa del censo `CONDUCTOR 1a`.
2. Usa cualquier PIN local para bloquear la sesion en ese navegador.
3. La app muestra posicion, las 4 puertas de turno y distancia circular desde cada puerta.

El PIN no autentica contra el portal CPE. Es solo una barrera local de la demo.

## Sincronizar puertas sin login

La ruta mas simple es leer la pantalla publica de puertas:

```powershell
npm run sync:puertas
```

El script lee la fila `CONDUCTOR 1a` de:

`https://portal.cpevalencia.com/Noray/Puertas.asp?...`

Y actualiza solo las 4 puertas de `TURNO`:

- `LAB`: diurna laborable
- `NOC`: super laborable
- `NOC-FES`: super festiva
- `FES`: diurna festiva

- `public/data/puertas-conductor-1a.json`
- `data/puertas-conductor-1a.json`
- `data/raw-puertas.txt`

La app carga automaticamente `public/data/puertas-conductor-1a.json`. Si no existe o falla, usa las puertas de respaldo incluidas en `src/censo.js`.

## Supabase

La app puede leer primero desde Supabase y caer al JSON local si no hay configuracion.

1. Ejecutar en el SQL Editor de Supabase:

```text
supabase/migrations/001_app_cpe_door_snapshots.sql
```

2. Crear `.env.local`:

```powershell
VITE_SUPABASE_URL=https://wvwdiywtlbffumshbboa.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=tu_publishable_key
CPE_SUPABASE_URL=https://wvwdiywtlbffumshbboa.supabase.co
CPE_SUPABASE_SERVICE_ROLE=tu_service_role_key
```

3. Ejecutar:

```powershell
npm run sync:puertas
```

El frontend solo usa la publishable key. La service role queda solo para scripts/Actions y no debe subirse a GitHub.

## Programar horarios

Los cambios de puertas pueden programarse en Windows con el Programador de tareas:

- 07:15
- 12:15
- 14:45

Accion recomendada:

```powershell
powershell.exe -ExecutionPolicy Bypass -NoProfile -Command "cd 'C:\Users\adria\Proyectos _IA\App-CPE'; npm run sync:puertas"
```

## Refresco hibrido al abrir la app

La app tambien puede pedir un refresco al abrirse:

1. El frontend llama a la Edge Function `refresh-puertas`.
2. La funcion revisa si el ultimo snapshot esta viejo.
3. Si hace falta, dispara el workflow `sync-puertas.yml`.
4. El workflow lee el enlace de Puertas con Playwright y guarda en Supabase.

Secretos necesarios en Supabase Edge Functions:

```powershell
GITHUB_SYNC_TOKEN=github_pat_con_permiso_actions_write
GITHUB_SYNC_REPO=TheViking816/App-CPE
GITHUB_SYNC_WORKFLOW=sync-puertas.yml
MIN_REFRESH_SECONDS=300
```

El token de GitHub debe tener permiso para ejecutar Actions en `TheViking816/App-CPE`. No se usa en el frontend.

## Sincronizar chapero completo con login

Tambien existe `scripts/sync-cpe.js`, pero no es la opcion principal. Solo se usaria si algun dia necesitas refrescar el censo completo desde `Chapero por especialidades`.

No guardar credenciales en el frontend, GitHub, localStorage ni archivos versionados.
