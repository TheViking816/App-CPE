// Record only a section name. Credential-bearing URLs never enter usage data.
export async function recordPersonalLinkOpen(base, key, token, section) {
  try {
    await fetch(`${base}/rest/v1/rpc/app_cpe_track_personal_link_open`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ p_token: token, p_section: section }),
      cache: 'no-store',
      signal: AbortSignal.timeout(2000)
    });
  } catch {
    // An unavailable monitor must not prevent a worker opening the portal.
  }
}
