const VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const CHECK_INTERVAL_MS = 60_000;
const RETRY_INTERVAL_MS = 3_000;
const QUIET_PERIOD_MS = 5_000;
const RELOAD_WINDOW_MS = 10 * 60_000;
const MAX_RELOADS_PER_VERSION = 3;

function editableElement(target) {
  const element = target?.closest?.("input, textarea, [contenteditable]");
  if (!element) return null;
  if (element.matches?.('input[type="checkbox"], input[type="radio"], input[type="file"], input[type="hidden"], input[type="button"], input[type="submit"]')) return null;
  if (element.hasAttribute?.("contenteditable") && !element.isContentEditable) return null;
  return element;
}

function editableValue(element) {
  return element.isContentEditable ? element.textContent || "" : element.value || "";
}

export function createVersionMonitor({
  currentVersion,
  baseUrl,
  fetchVersion = globalThis.fetch,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  storage = globalThis.sessionStorage,
  now = Date.now
}) {
  const versionUrl = new URL(`${baseUrl}app-version.json`, windowRef.location.href);
  const initialValues = new Map();
  let pendingVersion = "";
  let checking = false;
  let reloading = false;
  let retryTimer = null;
  let lastInteractionAt = -Infinity;
  let stopped = false;

  function hasUnsavedEditing() {
    for (const [element, initialValue] of initialValues) {
      if (!element.isConnected || editableValue(element) === initialValue) {
        initialValues.delete(element);
      } else {
        return true;
      }
    }
    return false;
  }

  function scheduleRetry() {
    if (retryTimer !== null) return;
    retryTimer = windowRef.setTimeout(() => {
      retryTimer = null;
      attemptReload();
    }, RETRY_INTERVAL_MS);
  }

  function attemptReload() {
    if (!pendingVersion || reloading || stopped || documentRef.visibilityState !== "visible") return;
    if (hasUnsavedEditing() || now() - lastInteractionAt < QUIET_PERIOD_MS) {
      scheduleRetry();
      return;
    }

    const key = `app-cpe-version-reloads:${pendingVersion}`;
    try {
      const previous = JSON.parse(storage.getItem(key) || "null");
      const withinWindow = previous && now() - previous.firstAt < RELOAD_WINDOW_MS;
      const attempts = withinWindow ? previous.count : 0;
      if (attempts >= MAX_RELOADS_PER_VERSION) return;
      storage.setItem(key, JSON.stringify({
        firstAt: withinWindow ? previous.firstAt : now(),
        count: attempts + 1
      }));
    } catch {
      // A URL marker prevents an endless reload loop when storage is blocked.
      const currentUrl = new URL(windowRef.location.href);
      if (currentUrl.searchParams.get("app_cpe_version") === pendingVersion) return;
      currentUrl.searchParams.set("app_cpe_version", pendingVersion);
      reloading = true;
      windowRef.location.replace(currentUrl.href);
      return;
    }
    reloading = true;
    windowRef.location.reload();
  }

  async function check() {
    if (checking || stopped || documentRef.visibilityState !== "visible") return;
    checking = true;
    try {
      versionUrl.searchParams.set("check", String(now()));
      const response = await fetchVersion(versionUrl.href, { cache: "no-store" });
      if (!response.ok) return;
      const { version } = await response.json();
      if (typeof version !== "string" || !VERSION_PATTERN.test(version)) return;
      pendingVersion = version === currentVersion ? "" : version;
      attemptReload();
    } catch {
      // Keep the running app usable while offline; the next check will retry.
    } finally {
      checking = false;
    }
  }

  function onFocusIn(event) {
    const element = editableElement(event.target);
    if (element && !initialValues.has(element)) initialValues.set(element, editableValue(element));
  }

  function onInput(event) {
    const element = editableElement(event.target);
    if (element && !initialValues.has(element)) {
      initialValues.set(element, element.defaultValue || "");
    }
    if (pendingVersion) attemptReload();
  }

  function onInteraction() {
    lastInteractionAt = now();
  }

  function onVisibilityChange() {
    if (documentRef.visibilityState === "visible") void check();
  }

  documentRef.addEventListener("focusin", onFocusIn, true);
  documentRef.addEventListener("input", onInput, true);
  documentRef.addEventListener("pointerdown", onInteraction, true);
  documentRef.addEventListener("keydown", onInteraction, true);
  documentRef.addEventListener("visibilitychange", onVisibilityChange);
  windowRef.addEventListener("focus", check);
  windowRef.addEventListener("pageshow", check);
  const interval = windowRef.setInterval(check, CHECK_INTERVAL_MS);
  void check();

  return {
    check,
    attemptReload,
    dispose() {
      stopped = true;
      windowRef.clearInterval(interval);
      if (retryTimer !== null) windowRef.clearTimeout(retryTimer);
      documentRef.removeEventListener("focusin", onFocusIn, true);
      documentRef.removeEventListener("input", onInput, true);
      documentRef.removeEventListener("pointerdown", onInteraction, true);
      documentRef.removeEventListener("keydown", onInteraction, true);
      documentRef.removeEventListener("visibilitychange", onVisibilityChange);
      windowRef.removeEventListener("focus", check);
      windowRef.removeEventListener("pageshow", check);
    }
  };
}
