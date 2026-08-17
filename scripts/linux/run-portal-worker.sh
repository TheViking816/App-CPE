#!/usr/bin/env bash
set -euo pipefail

repository_path="${CPE_REPOSITORY_PATH:-/opt/app-cpe}"
export CPE_PORTAL_BROWSER_CHANNEL="${CPE_PORTAL_BROWSER_CHANNEL:-bundled}"
export CPE_PORTAL_HEADLESS="${CPE_PORTAL_HEADLESS:-false}"
export CPE_PORTAL_WORKER_POLL_MS="${CPE_PORTAL_WORKER_POLL_MS:-2500}"
export CPE_PORTAL_WORKER_BATCH_SIZE="${CPE_PORTAL_WORKER_BATCH_SIZE:-3}"
export CPE_PORTAL_WORKER_PROFILE_ROOT="${CPE_PORTAL_WORKER_PROFILE_ROOT:-$repository_path/data/portal-oficial-chrome-profile/workers}"

cd "$repository_path"
exec /usr/bin/node scripts/portal-sync-worker.js
