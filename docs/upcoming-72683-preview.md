# Prueba privada de próximas contrataciones

Rama: `codex/proximas-contrataciones-preview`, creada desde el último commit remoto de producción `d8c6908` el 26/10/2026. Despliegue Vercel únicamente de preview. No modifica la base de datos ni el actualizador móvil.

En Sueldómetro, solo 72683 ve la tarjeta Próximas contrataciones. Lista hoy y los días posteriores de las lecturas ya guardadas, ordenados por fecha y jornada. Cada fecha/jornada aparece una vez. Al abrir el parte se muestra su equipo guardado, resaltando 72683, y la imagen del buque cuando está disponible. Los detalles compartidos se consultan por parte, fecha y jornada. Si faltan, el modal lo indica y no presenta otro equipo como si fuera el suyo.

«Ver parte guardado de ejemplo» abre un parte auténtico del historial propio, indicando expresamente que es histórico. No altera su fecha para simular una contratación actual.

## Lectura manual opcional

La ejecuta el usuario en su PC con la VPN que haya elegido:

1. Desde esta carpeta, ejecutar `powershell -NoProfile -File scripts/windows/read-upcoming-72683.ps1`.
2. Escribir `LEER` y pegar el enlace personal de Jornales de 72683 en el campo oculto.
3. El lector abre Chrome, lee el mes actual y el siguiente desde Jornales, y el equipo de cada parte de hoy o posterior usando la misma API de detalle que ya utilizaba el lector anterior. No pide clave de primas porque esta prueba no extrae importes.
4. Al terminar, se crea `.local/upcoming-72683.json`. En la web de preview, pulsar «Cargar lectura de prueba» y elegir ese archivo.

El archivo contiene solo contratación y equipos, sin URL personal, contraseña ni tokens. Se guarda en el navegador de la prueba para 72683. La importación valida chapa, fechas, jornadas y correspondencia de los partes. No escribe en los jornales, primas ni snapshots de producción. Los archivos de lectura están excluidos de Git.

El lector se detiene ante cualquier error y conserva el archivo completo anterior. No hay reintentos, alarmas ni acceso a otras cuentas. El agente no ejecuta este lector: solo lo inicia el usuario.

La comprobación local del lector usa respuestas simuladas, sin solicitudes a Noray. Una lectura real del usuario queda pendiente para validar el contenido actual de los equipos.
