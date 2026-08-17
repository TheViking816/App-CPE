#!/usr/bin/env bash
set -euo pipefail

repository_path="${CPE_REPOSITORY_PATH:-/opt/app-cpe}"
batch_size="${CPE_PORTAL_WORKER_BATCH_SIZE:-3}"
shared="$repository_path/data/portal-oficial-chrome-profile/shared"
profile_root="$repository_path/data/portal-oficial-chrome-profile/workers"

if pgrep -f "portal-oficial-chrome-profile" >/dev/null; then
  echo "Cierra primero el Chrome del portal." >&2
  exit 1
fi
if [[ ! -f "$shared/Local State" || ! -d "$shared/Default/Network" ]]; then
  echo "Falta una sesion compartida valida. Ejecuta primero open-cloudflare-setup.sh." >&2
  exit 1
fi

items=("Network" "Preferences" "Secure Preferences" "Local Storage" "Session Storage" "Service Worker" "IndexedDB" "WebStorage")
mkdir -p "$profile_root"

for slot in $(seq 1 "$batch_size"); do
  target="$profile_root/worker-$slot"
  if [[ -e "$target" ]]; then
    echo "Ya existe $target; no se sobrescribe." >&2
    exit 1
  fi
  mkdir -p "$target/Default"
  cp -a "$shared/Local State" "$target/Local State"
  for item in "${items[@]}"; do
    if [[ -e "$shared/Default/$item" ]]; then
      cp -a "$shared/Default/$item" "$target/Default/$item"
    fi
  done
done

echo "Creados $batch_size perfiles aislados en $profile_root"
