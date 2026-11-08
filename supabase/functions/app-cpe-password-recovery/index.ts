import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import { createRecoveryHandler } from './handler.js';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(createRecoveryHandler({
  db,
  ipSalt: Deno.env.get('APP_CPE_RECOVERY_IP_SALT')!,
  async sendEmail({ to, token }) {
    const secret = Deno.env.get('APP_CPE_RECOVERY_RELAY_SECRET');
    if (!secret) throw new Error('Email not configured');
    const response = await fetch('https://portalestiba-push-backend-one.vercel.app/api/auth/app-cpe-recovery-email', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: to, token }), signal: AbortSignal.timeout(12000)
    });
    if (!response.ok || !(await response.json()).ok) throw new Error('Email not accepted');
  }
}));
