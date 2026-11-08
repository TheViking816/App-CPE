# Recuperación de contraseña

El login permite solicitar un enlace por chapa. Solo se envía al correo guardado en `app_cpe_users.email`. El registro acepta un correo opcional y «Mis datos» permite actualizarlo confirmando la contraseña real de la cuenta. Las cuentas sin correo deben contactar con soporte.

La Edge Function `app-cpe-password-recovery` utiliza RPC restringidas a `service_role`. Los tokens aleatorios de 256 bits se guardan como SHA-256 en una tabla privada con RLS, caducan en una hora y se consumen junto con la actualización bcrypt en la misma transacción. Un nuevo enlace invalida el anterior. Un cambio de correo revoca los enlaces pendientes. La recuperación cierra todas las sesiones anteriores.

Hay límites persistentes de tres solicitudes por chapa y diez por IP por hora. Solo se almacena un hash de la IP con una sal secreta. La respuesta pública es genérica, también si el envío falla; en ese caso se revoca el enlace y se registra un error sin correo ni token.

El envío usa la ruta privada `/api/auth/app-cpe-recovery-email` de `portalestiba-push-backend-one.vercel.app`. Esta ruta acepta una clave interna, destinatario y token, y construye un mensaje fijo con destino al dominio público de App CPE. Reutiliza Gmail de PortalEstibaVLC. Si en ese backend se configuran `RESEND_API_KEY` y un `RESEND_FROM_EMAIL` verificado, usará Resend.

Secretos de Supabase: `APP_CPE_RECOVERY_RELAY_SECRET` y `APP_CPE_RECOVERY_IP_SALT`. El backend de correo debe tener el mismo `APP_CPE_RECOVERY_RELAY_SECRET`. Ninguno se incluye en el frontend.

Despliegue de la función: `npx supabase functions deploy app-cpe-password-recovery --remote=wvwdiywtlbffumshbboa --no-verify-jwt --use-api --yes`. El acceso público a la función es necesario antes del login; las operaciones privilegiadas se realizan únicamente con la clave de servicio del servidor.

Pruebas: `node --test test/password-recovery.test.js test/auth-recovery.test.js`. `test/password-recovery.integration.sql` comprueba los cambios reales en una transacción que termina con `rollback`, sin modificar cuentas existentes.
