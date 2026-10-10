import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { canOpenNorayLinks, supabase } from './supabaseClient.js';

export default function PersonalNoraySectionLink({ session, section, label }) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!session?.token) return;
    let active = true;
    setAvailable(false);
    Promise.allSettled([
      supabase.rpc('app_cpe_has_manual_noray_section_link', { p_token: session.token, p_section: 'dobles' }),
      supabase.rpc('app_cpe_has_manual_noray_section_link', { p_token: session.token, p_section: 'vacaciones' }),
      supabase.rpc('app_cpe_has_manual_donde_voy_link', { p_token: session.token }),
      canOpenNorayLinks({ token: session.token })
    ]).then((results) => {
      if (!active) return;
      setAvailable(results.some((result, index) => result.status === 'fulfilled'
        && (index === 3 ? result.value === true : !result.value.error && result.value.data === true)));
    });
    return () => { active = false; };
  }, [session?.token]);

  if (!available) return null;
  return <form className="rest-portal-availability-link" action="/api/noray-section" method="post" target="_blank" rel="noopener noreferrer">
    <input type="hidden" name="token" value={session.token} />
    <input type="hidden" name="section" value={section} />
    <button type="submit">{label} <ExternalLink size={15} aria-hidden="true" /></button>
  </form>;
}
