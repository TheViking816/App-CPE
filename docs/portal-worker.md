# Worker persistente del portal

Este worker sustituye el arranque de GitHub Actions para cada lectura. Consume los trabajos `queued` de Supabase y ejecuta el sincronizador de forma secuencial.

## Variables

- `CPE_SUPABASE_URL`
- `CPE_SUPABASE_SERVICE_ROLE`
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
