# Laboratorio de Chrome local frente a Cloudflare

Esta rama no cambia producción ni el worker instalado. Su finalidad es comprobar una sola chapa antes de decidir si el enfoque es viable.

## Diseño

- Windows abre Google Chrome directamente, con una carpeta de perfil exclusiva y un puerto CDP local.
- No se usan `--no-sandbox`, modo headless ni argumentos de Playwright al arrancar ese Chrome.
- Si Cloudflare pide verificación, la persona la completa en esa ventana visible.
- El lector se conecta después al Chrome ya abierto y no lo cierra al terminar.
- Las credenciales de Supabase siguen protegidas con DPAPI y las contraseñas del portal se eliminan de los errores.

## Diagnóstico TLS gratuito

```powershell
python -m venv .venv-cloudflare-lab
.\.venv-cloudflare-lab\Scripts\python -m pip install -r requirements-cloudflare-lab.txt
.\.venv-cloudflare-lab\Scripts\python scripts\cloudflare-tls-diagnostic.py
```

Este diagnóstico imita la huella TLS de Chrome y solo clasifica la respuesta pública inicial. No inicia sesión ni guarda contenido del portal.

## Prueba de Chrome

1. Abrir el gateway:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/start-cloudflare-gateway.ps1
```

2. Si aparece Cloudflare, marcar la casilla en esa ventana y esperar a que aparezca el portal.
3. Comprobar diez contextos aislados sin introducir credenciales:

```powershell
$env:CPE_PORTAL_CDP_ENDPOINT = "http://127.0.0.1:9223"
node scripts/cloudflare-clearance-pool-check.js
```

4. Solo si la prueba anterior funciona, ejecutar un único trabajo de control:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/requeue-cloudflare-lab-job.ps1 -Chapa 72683
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/run-cloudflare-lab-job.ps1 -JobId <uuid-de-72683>
```

El primer comando recupera la clave temporal desde Vault y restaura después el estado exacto de todas las demás filas. Debe usarse solo con el worker general detenido.

5. Tras validar 72683, ejecutar una única tanda real de hasta diez trabajos:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/windows/run-cloudflare-gateway-batch.ps1 -BatchSize 10
```

Cada trabajo recibe un contexto independiente con únicamente la autorización de Cloudflare copiada en memoria. Las sesiones del portal no se comparten. El proceso termina después de esa tanda y no queda escuchando la cola.

## Criterios

El enfoque se considera útil si Chrome llega al formulario del portal sin una nueva verificación, la prueba de contextos informa `passed: 10` y 72683 termina correctamente. No se conectará la cola general hasta cumplir los tres criterios.

Cloudflare puede volver a solicitar verificación aunque la cookie no haya vencido. Por ello este sistema, si funciona, reduce la intervención manual pero no garantiza eliminarla.

## Resultado real del 18/08/2026

- El diagnóstico basado únicamente en huella TLS recibió un desafío `403`, por lo que se descartó.
- El Chrome normal conservó la autorización después de cerrarlo correctamente y volverlo a abrir.
- Diez contextos aislados superaron Cloudflare usando la misma autorización en memoria.
- La chapa de control 72683 completó todas las secciones del portal.
- Una tanda real de diez trabajos ejecutó cuatro lecturas completas simultáneas: 72743, 72691, 72262 y 72710.
- Los otros trabajos fueron rechazados por credenciales ausentes o incorrectas; no fallaron por Cloudflare.
- Las filas en cola sin contraseña se cierran ahora como fallidas antes de abrir un proceso de navegador.

Esta prueba demuestra que la concurrencia de diez contextos es técnicamente viable. No demuestra que la autorización vaya a durar indefinidamente: si Cloudflare vuelve a desafiar el Chrome gateway, habrá que validarlo de nuevo antes de ejecutar otra tanda.
