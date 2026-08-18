# Prueba aislada con Bright Data Browser API

Esta rama no modifica producción. Sustituye únicamente el navegador local por una sesión remota de Browser API cuando existe `BRIGHTDATA_BROWSER_WS_ENDPOINT`. Sin esa variable conserva exactamente el comportamiento local.

## Preparación

1. Crear una zona **Browser API** en Bright Data.
2. Copiar el endpoint WebSocket completo desde el panel y guardarlo localmente; nunca en Git ni en el chat.
3. Mantener detenido el worker de Windows para que no compita por la misma fila.
4. Probar primero una sola chapa de control.

Browser API ejecuta el navegador, proxy y resolución de CAPTCHA en infraestructura de Bright Data. Por ello las credenciales introducidas en el portal y los datos consultados atraviesan ese proveedor. Antes de usarlo con todos los usuarios hay que revisar consentimiento, contrato y tratamiento de datos.

La prueba se acepta únicamente si 72683 termina `completed`, las secciones principales contienen datos y el consumo mostrado en Bright Data resulta asumible. Después se probará una tanda pequeña; no se habilita la cola completa directamente.
