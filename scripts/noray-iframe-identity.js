// Read only the non-secret registro number from an authenticated Noray iframe.
// Never persist or log the URL: its pwd parameter is a reusable credential.
export function norayRegistroFromUrl(rawUrl, chapa) {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== "https://norayweb.cpevalencia.com") return null;
    if (url.searchParams.get("req") !== "login" || url.searchParams.get("usr") !== String(chapa)) return null;
    if (!/^[a-f0-9]{64}$/i.test(url.searchParams.get("pwd") || "")) return null;
    const registro = url.searchParams.get("rec") || "";
    return /^[1-9]\d{0,9}$/.test(registro) ? Number(registro) : null;
  } catch {
    return null;
  }
}
