#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este instalador como root." >&2
  exit 1
fi

repository_path="${CPE_REPOSITORY_PATH:-/opt/app-cpe}"
worker_user="${CPE_WORKER_USER:-appcpe}"
worker_home="/home/$worker_user"

if [[ ! -f "$repository_path/package-lock.json" ]]; then
  echo "No se encuentra el repositorio en $repository_path." >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl gnupg git xvfb openbox x11vnc novnc websockify

if ! command -v node >/dev/null || [[ "$(node --version | tr -d 'v' | cut -d. -f1)" -lt 20 ]]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

if ! command -v google-chrome >/dev/null; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://dl.google.com/linux/linux_signing_key.pub \
    | gpg --dearmor -o /etc/apt/keyrings/google-chrome.gpg
  echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y google-chrome-stable
fi

if ! id "$worker_user" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$worker_user"
fi

chown -R "$worker_user:$worker_user" "$repository_path"
sudo -u "$worker_user" npm ci --prefix "$repository_path"
install -d -m 0750 -o root -g "$worker_user" /etc/appcpe

cat >/etc/appcpe/worker.env.example <<EOF
CPE_SUPABASE_SECRET_KEY=PEGA_AQUI_LA_CLAVE_DEDICADA
CPE_REPOSITORY_PATH=$repository_path
CPE_PORTAL_WORKER_BATCH_SIZE=10
CPE_PORTAL_WORKER_PROFILE_ROOT=$repository_path/data/portal-oficial-chrome-profile/workers
DISPLAY=:99
EOF
chmod 0600 /etc/appcpe/worker.env.example

cat >/etc/systemd/system/appcpe-display.service <<EOF
[Unit]
Description=App CPE virtual display
After=network.target

[Service]
User=$worker_user
ExecStart=/usr/bin/Xvfb :99 -screen 0 1600x1200x24 -nolisten tcp -ac
Restart=always

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/appcpe-openbox.service <<EOF
[Unit]
Description=App CPE lightweight desktop
Requires=appcpe-display.service
After=appcpe-display.service

[Service]
User=$worker_user
Environment=DISPLAY=:99
ExecStartPre=/bin/sleep 2
ExecStart=/usr/bin/openbox-session
Restart=always

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/appcpe-vnc.service <<EOF
[Unit]
Description=App CPE private VNC bridge
Requires=appcpe-display.service
After=appcpe-display.service

[Service]
User=$worker_user
ExecStartPre=/bin/sleep 2
ExecStart=/usr/bin/x11vnc -display :99 -localhost -rfbport 5900 -forever -shared -nopw
Restart=always

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/appcpe-novnc.service <<EOF
[Unit]
Description=App CPE private web desktop
Requires=appcpe-vnc.service
After=appcpe-vnc.service

[Service]
User=$worker_user
ExecStart=/usr/bin/websockify --web=/usr/share/novnc/ 127.0.0.1:6080 localhost:5900
Restart=always

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/appcpe-portal-worker.service <<EOF
[Unit]
Description=App CPE portal synchronization worker
Requires=appcpe-display.service
After=network-online.target appcpe-display.service appcpe-openbox.service
Wants=network-online.target

[Service]
User=$worker_user
WorkingDirectory=$repository_path
EnvironmentFile=/etc/appcpe/worker.env
ExecStart=$repository_path/scripts/linux/run-portal-worker.sh
Restart=always
RestartSec=10
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF

chmod +x "$repository_path/scripts/linux/"*.sh
systemctl daemon-reload
systemctl enable --now appcpe-display.service appcpe-openbox.service appcpe-vnc.service appcpe-novnc.service

echo "Escritorio virtual instalado y ligado solo a localhost."
echo "Crea /etc/appcpe/worker.env desde worker.env.example antes de iniciar el worker."
