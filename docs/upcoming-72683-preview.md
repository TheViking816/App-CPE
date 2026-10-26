# Prueba privada de próximas contrataciones

Rama: `codex/proximas-contrataciones-preview`, creada desde el último commit remoto de producción `d8c6908` el 26/10/2026. Despliegue Vercel únicamente de preview. No modifica la web de producción ni el actualizador móvil.

En Sueldómetro, solo 72683 ve la tarjeta Próximas contrataciones bajo el encabezado y antes del extracto salarial, integrada con el estilo normal de la aplicación. Lista hoy y los días posteriores de las lecturas guardadas, ordenados por fecha y jornada. Cada fecha/jornada aparece una vez. Al abrir el parte se muestra su equipo guardado, resaltando 72683, y la imagen del buque cuando está disponible. No muestra etiquetas, ejemplos ni controles de prueba en la interfaz.

El canal privado `upcoming-contracts-72683` usa la tabla de revisión y la RPC de lectura que ya existían. No se crea ni se altera ninguna tabla, función o permiso. Los datos de ese canal solo se consultan en esta rama y se renuevan cada minuto con la página visible. Los detalles compartidos se consultan por parte, fecha y jornada cuando no se dispone del equipo guardado. Si faltan, el modal lo indica y no presenta otro equipo como si fuera el suyo.

## Lectura manual opcional

La ejecuta el usuario en su PC con la VPN que haya elegido:

1. Desde esta carpeta, ejecutar `powershell -NoProfile -File scripts/windows/read-upcoming-72683.ps1`.
2. Escribir `LEER` y pegar el enlace personal de Jornales de 72683 en el campo oculto.
3. El lector abre Chrome, lee el mes actual y el siguiente desde Jornales, y el equipo de cada parte de hoy o posterior usando la misma API de detalle que ya utilizaba el lector anterior. No pide clave de primas porque esta prueba no extrae importes.
4. Solo tras completar y validar todos los partes, guarda el resultado en el canal privado de revisión de 72683. La web lo muestra sin importación de archivos. Conserva también una copia en `.local/upcoming-72683.json`.

La credencial local cifrada del worker se lee sin modificarla para guardar únicamente el canal de revisión. El archivo y el snapshot contienen solo contratación y equipos, sin URL personal, contraseña ni tokens. Se validan chapa, fechas, jornadas y correspondencia de los partes. No escribe en los jornales, primas ni snapshots de producción. Los archivos de lectura están excluidos de Git.

El lector se detiene ante cualquier error; no publica resultados parciales. No hay reintentos, alarmas ni acceso a otras cuentas. El agente no ejecuta este lector: solo lo inicia el usuario.

Las comprobaciones locales del lector y del guardado usan respuestas simuladas, sin solicitudes a Noray ni escrituras remotas. Una lectura real iniciada por el usuario queda pendiente para validar el contenido actual de los equipos.
