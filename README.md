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
3. La app muestra posicion, puertas laborables/festivas y distancia circular desde cada puerta.

El PIN no autentica contra el portal CPE. Es solo una barrera local de la demo.

## Sincronizar puertas sin login

La ruta mas simple es leer la pantalla publica de puertas:

```powershell
npm run sync:puertas
```

El script lee la fila `CONDUCTOR 1a` de:

`https://portal.cpevalencia.com/Noray/Puertas.asp?...`

Y actualiza solo las columnas de `TURNO`:

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

## Sincronizar chapero completo con login

Tambien existe `scripts/sync-cpe.js`, pero no es la opcion principal. Solo se usaria si algun dia necesitas refrescar el censo completo desde `Chapero por especialidades`.

No guardar credenciales en el frontend, GitHub, localStorage ni archivos versionados.
