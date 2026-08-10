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

## Actualizar censos de especialidades

Guarda el texto copiado de `Chapero por especialidades` en un archivo y ejecuta primero una comparacion:

```powershell
npm run sync:censos -- --input "C:\ruta\censos.txt"
```

El comando comprueba el tamano declarado, duplicados, primera y ultima chapa, altas, bajas y cambios de posicion. Si el resultado es correcto, aplica el nuevo orden con:

```powershell
npm run sync:censos -- --input "C:\ruta\censos.txt" --apply
```

La actualizacion modifica el listado y `expectedSize` en `src/censo.js`. Sin `--apply` nunca cambia la app. Tambien puede intentar una lectura directa usando `CPE_PORTAL_USER` y `CPE_PORTAL_PASSWORD`, aunque el portal puede bloquear la automatizacion; el TXT es el metodo mas estable.

No guardar credenciales en el frontend, GitHub, localStorage ni archivos versionados.

## Prueba portal oficial

El portal oficial bloquea la lectura desde Vercel/serverless. Para jornales, descansos, SL, FS y primas se usa un sincronizador local con Chrome real:

```powershell
$env:CPE_PORTAL_USER="72683"
$env:CPE_PORTAL_PASSWORD="tu_clave_portal"
$env:CPE_PORTAL_SECURITY_KEY="tu_clave_primas_opcional"
$env:CPE_SUPABASE_URL="https://wvwdiywtlbffumshbboa.supabase.co"
$env:CPE_SUPABASE_SERVICE_ROLE="tu_service_role_key"
npm run sync:portal
```

Antes de usarlo en la app, ejecutar en Supabase:

```text
supabase/migrations/009_app_cpe_portal_snapshots.sql
```

El script guarda el ultimo resultado por chapa en `app_cpe_portal_snapshots`. La app no lee esa tabla directamente: llama a `app_cpe_get_portal_snapshot(token)` y Supabase devuelve solo el snapshot de la chapa que ha iniciado sesion en App CPE.
