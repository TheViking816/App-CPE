#!/usr/bin/env bash
set -euo pipefail

repository_path="${CPE_REPOSITORY_PATH:-/opt/app-cpe}"
profile_path="$repository_path/data/portal-oficial-chrome-profile/shared"

if systemctl is-active --quiet appcpe-portal-worker.service; then
  echo "Deten primero el worker: sudo systemctl stop appcpe-portal-worker.service" >&2
  exit 1
fi

mkdir -p "$profile_path"
chromium_path="$(cd "$repository_path" && node --input-type=module -e \
  'import { chromium } from "playwright"; process.stdout.write(chromium.executablePath())')"
if [[ ! -x "$chromium_path" ]]; then
  echo "No se encuentra Chromium ARM. Ejecuta primero el instalador." >&2
  exit 1
fi
echo "Abre el escritorio remoto, supera Cloudflare y cierra Chrome por completo."
DISPLAY="${DISPLAY:-:99}" "$chromium_path" \
  --user-data-dir="$profile_path" \
  --disable-extensions \
  --no-first-run \
  --no-default-browser-check \
  'https://portal.cpevalencia.com/#/User'
