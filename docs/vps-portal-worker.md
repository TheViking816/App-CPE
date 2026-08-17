# Prueba del worker del portal en un VPS

Esta rama no modifica producción. Prepara un worker alternativo en un VPS x86 con IP pública estable, escritorio virtual persistente y tandas estrictas de hasta 10 usuarios.

## Servidor recomendado para la prueba

- Hetzner Cloud CX43, Ubuntu 24.04, región `nbg1`.
- 8 vCPU compartidas, 16 GB de RAM y arquitectura x86.
- IPv4 primaria estable mientras el servidor exista.
- El escritorio no publica puertos VNC en Internet: se abre únicamente mediante un túnel SSH.

No se debe aplicar todavía la migración `20260817182201_set_requested_portal_sync_schedule.sql`. Solo se aplicará a producción después de validar el VPS y recibir autorización expresa.

## Aprovisionamiento

Requisitos en el PC administrador: Terraform, una clave SSH y un token de API de Hetzner con permiso de lectura/escritura.

```powershell
cd deploy/hetzner
Copy-Item terraform.tfvars.example terraform.tfvars
# Completar únicamente ssh_public_key en terraform.tfvars.
$env:TF_VAR_hcloud_token = Read-Host 'Token de Hetzner'
terraform init
terraform plan
terraform apply
$env:TF_VAR_hcloud_token = $null
```

El proceso instala Chrome, Node.js, un escritorio virtual privado y los servicios base. No inicia el worker ni recibe acceso a Supabase.

## Configuración segura del secreto

Conectarse por SSH y crear el archivo de entorno sin dejar la clave en el historial:

```bash
read -rsp "Clave dedicada de Supabase: " CPE_KEY; echo
sudo install -m 600 -o root -g root /dev/null /etc/appcpe/worker.env
printf '%s\n' \
  "CPE_SUPABASE_SECRET_KEY=$CPE_KEY" \
  "CPE_REPOSITORY_PATH=/opt/app-cpe" \
  "CPE_PORTAL_WORKER_BATCH_SIZE=1" \
  "CPE_PORTAL_WORKER_PROFILE_ROOT=/opt/app-cpe/data/portal-oficial-chrome-profile/workers" \
  "DISPLAY=:99" | sudo tee /etc/appcpe/worker.env >/dev/null
unset CPE_KEY
```

Se empieza con una sola ejecución para validar la IP nueva.

## Superar Cloudflare en el escritorio privado

En el PC, mantener abierto este túnel:

```powershell
ssh -L 6080:127.0.0.1:6080 root@IP_DEL_VPS
```

Abrir `http://127.0.0.1:6080/vnc.html?autoconnect=true` y, por otra consola SSH:

```bash
sudo systemctl stop appcpe-portal-worker.service
sudo -u appcpe -H env DISPLAY=:99 CPE_REPOSITORY_PATH=/opt/app-cpe \
  /opt/app-cpe/scripts/linux/open-cloudflare-setup.sh
```

Superar el desafío, comprobar que aparece el portal y cerrar Chrome completamente. Después crear los diez perfiles aislados:

```bash
sudo -u appcpe -H env CPE_REPOSITORY_PATH=/opt/app-cpe CPE_PORTAL_WORKER_BATCH_SIZE=10 \
  /opt/app-cpe/scripts/linux/seed-portal-worker-profiles.sh
```

## Prueba sin cambiar los horarios de producción

1. Detener temporalmente el worker de Windows para que no compita por el trabajo.
2. Mantener el VPS con tamaño de tanda `1`.
3. Iniciar el servicio: `sudo systemctl enable --now appcpe-portal-worker.service`.
4. Desde un perfil real de la app, pulsar una vez `Actualizar`.
5. Verificar `completed — Portal sincronizado` y revisar `journalctl -u appcpe-portal-worker.service -f`.
6. Si funciona, cambiar `CPE_PORTAL_WORKER_BATCH_SIZE=10`, ejecutar `sudo systemctl restart appcpe-portal-worker.service` y probar 18 trabajos: debe terminar una tanda de 10 antes de empezar la de 8.
7. Volver a iniciar el worker de Windows mientras se decide cuál queda definitivo.

Si el servidor se reinicia, el escritorio virtual y el worker arrancan con systemd sin iniciar sesión ni abrir enlaces. Los trabajos que Supabase ya dejó en cola se consumen automáticamente.

## Horarios preparados, aún no desplegados

La migración nueva limita la creación automática a hora de Madrid:

`02:00, 07:30, 08:00, 12:30, 14:00, 14:45, 15:00 y 20:00`.

Las actualizaciones manuales siguen entrando inmediatamente en la misma cola. El worker de esta rama no crea sincronizaciones adicionales al arrancar: únicamente consume las que ya estén en cola.
