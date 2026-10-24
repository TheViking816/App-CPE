# Sincronización personal de Noray

Esta función no tiene horario. El agente del PC solo mantiene una conexión con Supabase para mostrar si está preparado. **No abre Noray** hasta que la chapa 72683 pulsa «Sincronizar ahora» en Monitor.

## Puesta en marcha en el PC

El agente usa la credencial local cifrada que ya emplea el worker de App CPE. Instalarlo desde una copia actualizada de la rama de producción:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows/install-personal-noray-sync-agent.ps1
```

La tarea `App CPE - Sincronizacion personal manual` se inicia al entrar en Windows. Su mera ejecución no hace consultas a Noray. El Monitor muestra «PC conectado» cuando recibe el latido.

## Ejecución

Solo el titular de la chapa 72683 inicia el lote desde Monitor, después de comprobar su conexión. Se incluyen únicamente las cuentas activas que tienen enlace personal guardado. El agente procesa una cuenta cada vez, con una pausa entre cuentas. Cada cuenta guarda una copia independiente de jornales, descansos y vacaciones. Los jornales introducidos manualmente no se sobrescriben.

El primer error detiene todo el lote, también un HTTP 403, 429 o una comprobación de acceso. No hay reintentos ni ejecución automática posterior. El Monitor indica las cuentas terminadas y la causa de la parada. El registro local está en `%LOCALAPPDATA%\AppCPE\personal-noray\agent.log`; no incluye enlaces ni contraseñas.

Para detener el agente, finalizar la tarea desde el Programador de tareas. Una ejecución en curso se marcará detenida al perder el latido del PC.
