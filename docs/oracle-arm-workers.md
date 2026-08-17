# Prueba de los dos workers en Oracle Always Free

Esta rama es independiente de producción y de las variantes Windows/Hetzner.
Prepara una instancia Oracle `VM.Standard.A1.Flex` ARM64 con 2 OCPU, 12 GB de
RAM, Ubuntu 24.04, Chromium ARM, escritorio privado y los dos workers:

- sincronización personal de App CPE, inicialmente en tandas de 3;
- tablón general compartido por App CPE y PortalEstibaVLC.

Terraform sólo publica SSH. El escritorio noVNC se alcanza mediante túnel y los
workers permanecen desactivados hasta configurar secretos y superar Cloudflare.

## Datos necesarios de Oracle

Desde la consola de Oracle hay que obtener el OCID del tenancy, usuario y
compartment, crear una clave API y tener una clave pública SSH. No guardes la
clave privada ni secretos de Supabase en Git.

```powershell
cd deploy/oracle
Copy-Item terraform.tfvars.example terraform.tfvars
# Completar los OCID, fingerprint, ruta PEM, region y clave SSH.
terraform init
terraform plan
terraform apply
```

Si Oracle devuelve `Out of host capacity`, no se ha cobrado ni creado una
instancia. Cambia `availability_domain_index` si la región ofrece más dominios o
vuelve a intentarlo más tarde. Always Free sólo se puede usar en la región
principal de la cuenta.

## Esperar la instalación

```bash
ssh ubuntu@IP_ORACLE
cloud-init status --wait
sudo tail -n 100 /var/log/appcpe-install.log
sudo tail -n 100 /var/log/appcpe-contracting-install.log
```

Los dos logs deben terminar sin errores. El aprovisionamiento descarga Chromium
ARM64 mediante Playwright.

## Configurar secretos

Crear `/etc/appcpe/worker.env` desde `worker.env.example` con una clave secreta
dedicada del Supabase de App CPE. Mantener inicialmente
`CPE_PORTAL_WORKER_BATCH_SIZE=3`.

Crear `/etc/appcpe/contracting.env` desde su ejemplo con una chapa lectora, su
contraseña y una clave secreta dedicada del Supabase de PortalEstibaVLC. Aplicar
permisos `0600` a ambos archivos.

## Superar Cloudflare

Desde el PC:

```powershell
ssh -L 6080:127.0.0.1:6080 ubuntu@IP_ORACLE
```

Abrir `http://127.0.0.1:6080/vnc.html?autoconnect=true`. En otra conexión SSH,
abrir primero el perfil personal, superar Cloudflare y cerrar Chromium. Crear
después tres perfiles aislados:

```bash
sudo -u appcpe -H env DISPLAY=:99 CPE_REPOSITORY_PATH=/opt/app-cpe \
  /opt/app-cpe/scripts/linux/open-cloudflare-setup.sh
sudo -u appcpe -H env CPE_REPOSITORY_PATH=/opt/app-cpe CPE_PORTAL_WORKER_BATCH_SIZE=3 \
  /opt/app-cpe/scripts/linux/seed-portal-worker-profiles.sh
```

Repetir el desafío en el perfil separado del tablón:

```bash
sudo -u appcpe -H env DISPLAY=:99 PORTAL_ESTIBA_REPOSITORY_PATH=/opt/portal-estiba-vlc \
  /opt/portal-estiba-vlc/scripts/linux/open-contracting-cloudflare-setup.sh
```

## Prueba controlada

1. Ejecutar una vez `appcpe-contracting-worker.service` y confirmar que cambia
   `contratacion_turno_snapshot.updated_at` y ambos tablones coinciden.
2. Detener temporalmente el worker Windows, iniciar el worker personal Oracle y
   solicitar manualmente tres sincronizaciones.
3. Confirmar tres trabajos `completed` y revisar memoria/CPU con `systemd-cgtop`.
4. Probar después 10 trabajos: Oracle debe procesarlos como 3+3+3+1.
5. Sólo tras varios ciclos correctos, activar el timer del tablón y dejar el
   worker personal iniciado al arrancar.

```bash
sudo systemctl start appcpe-contracting-worker.service
sudo journalctl -u appcpe-contracting-worker.service -n 200 --no-pager
sudo systemctl enable --now appcpe-contracting-worker.timer
sudo systemctl enable --now appcpe-portal-worker.service
```

Para 100 usuarios se mantiene inicialmente la tanda de 3. Se aumentará únicamente
si las métricas y el portal permanecen estables; la capacidad de Oracle y la
protección de Cloudflare sólo pueden verificarse con una instancia real.
