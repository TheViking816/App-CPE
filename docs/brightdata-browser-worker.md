# Prueba aislada con Bright Data Browser API

Esta rama no modifica producción. Sustituye únicamente el navegador local por una sesión remota de Browser API cuando existe `BRIGHTDATA_BROWSER_WS_ENDPOINT`. Sin esa variable conserva exactamente el comportamiento local.

## Preparación

1. Crear una zona **Browser API** en Bright Data.
2. Copiar el endpoint WebSocket completo desde el panel y guardarlo localmente; nunca en Git ni en el chat.
3. Mantener detenido el worker de Windows para que no compita por la misma fila.
4. Probar primero una sola chapa de control.

El endpoint se guarda con DPAPI en `%LOCALAPPDATA%\AppCPE\brightdata\browser-endpoint.dpapi`. Para ejecutar un único trabajo sin revelar ninguna credencial:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/run-brightdata-job.ps1 -JobId <uuid>
```

El lanzador descifra las dos credenciales solo en memoria, limpia las variables al terminar y no inicia el worker general.

## Resultado de la prueba

Browser API resolvió correctamente el desafío de Cloudflare, pero bloqueó la escritura en el campo de contraseña. Bright Data impide por defecto los accesos a contenido privado. Para habilitarlo exige completar el proceso KYC y solicitar a Compliance una excepción para la zona. La rama detecta este caso y termina con un mensaje explícito; no se debe activar para toda la cola mientras ese permiso no exista.

Browser API ejecuta el navegador, proxy y resolución de CAPTCHA en infraestructura de Bright Data. Por ello las credenciales introducidas en el portal y los datos consultados atraviesan ese proveedor. Antes de usarlo con todos los usuarios hay que revisar consentimiento, contrato y tratamiento de datos.

La prueba se acepta únicamente si 72683 termina `completed`, las secciones principales contienen datos y el consumo mostrado en Bright Data resulta asumible. Después se probará una tanda pequeña; no se habilita la cola completa directamente.
