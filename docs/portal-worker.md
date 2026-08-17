# Worker persistente del portal

Este worker sustituye el arranque de GitHub Actions para cada lectura. Consume los trabajos `queued` de Supabase y ejecuta el sincronizador de forma secuencial.

## Variables

- `CPE_SUPABASE_URL`
- `CPE_SUPABASE_SECRET_KEY` (recomendada: una clave `sb_secret_` dedicada)
- `CPE_SUPABASE_SERVICE_ROLE` (solo compatibilidad con la clave JWT antigua)
- `CPE_PORTAL_HEADLESS=true`
- `CPE_PORTAL_BROWSER_CHANNEL=bundled`
- `CPE_PORTAL_WORKER_POLL_MS=2500` (opcional)

## Despliegue

1. Desplegar `Dockerfile.portal-worker` en un servicio persistente (Render, Railway, Fly.io o equivalente).
2. Configurar las variables anteriores en el servicio.
3. Configurar el secreto `CPE_PORTAL_EXECUTION_MODE=persistent` en las Edge Functions de Supabase.
4. Desplegar `refresh-portal` y `schedule-portal-sync`.

Mientras el modo no sea `persistent`, las funciones conservan GitHub Actions como fallback.

El primer refresco que construye el resumen anual recorre los meses transcurridos. Los siguientes refrescos leen únicamente el mes actual y reutilizan el histórico guardado.

## Instalacion en Windows

El worker local usa Chrome desde la conexion del ordenador, procesa una sola chapa cada vez y mantiene un perfil de navegador independiente para cada chapa. Al arrancar recupera automaticamente los usuarios cuya ultima lectura tenga mas de dos horas.

1. Crear en Supabase una clave secreta dedicada para este worker.
2. Ejecutar `scripts/windows/install-portal-worker.ps1`. La clave se cifra con DPAPI para el usuario actual de Windows; no se guarda en el repositorio ni en texto plano.
3. Aplicar la migracion `portal_worker_startup_catchup` y desplegar las Edge Functions.
4. Cambiar `CPE_PORTAL_EXECUTION_MODE` a `persistent` solamente cuando la tarea local este en ejecucion.

La tarea `App CPE Portal Worker` se inicia al entrar en Windows y se reinicia si falla. Si el PC esta apagado o suspendido no hay lecturas; cuando vuelva a encenderse se pondra al dia en serie. Los logs quedan en `%LOCALAPPDATA%\AppCPE\portal-worker\logs`.

Para volver al sistema de produccion anterior, establecer `CPE_PORTAL_EXECUTION_MODE=actions` y desplegar de nuevo las dos Edge Functions. La rama `main` no necesita incorporar estos cambios.
