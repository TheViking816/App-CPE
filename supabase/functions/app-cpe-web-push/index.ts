import { createClient } from 'npm:@supabase/supabase-js@2.109.0';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const dispatchToken = request.headers.get('x-cpe-push-token');
  if (!dispatchToken) return new Response('Unauthorized', { status: 401 });
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return new Response('Service unavailable', { status: 503 });
  const db = createClient(url, serviceKey);
  const { data: current, error: configError } = await db.rpc('app_cpe_push_private_config', { p_dispatch_token: dispatchToken });
  if (configError) return new Response('Unauthorized', { status: 401 });
  let keys = current;
  if (!keys?.publicKey || !keys?.privateKey) {
    const generated = webpush.generateVAPIDKeys();
    const { error } = await db.rpc('app_cpe_push_configure', {
      p_dispatch_token: dispatchToken,
      p_public_key: generated.publicKey,
      p_private_key: generated.privateKey
    });
    if (error) return new Response('Configuration failed', { status: 500 });
    const result = await db.rpc('app_cpe_push_private_config', { p_dispatch_token: dispatchToken });
    keys = result.data;
  }
  webpush.setVapidDetails('mailto:portalestibavlc@gmail.com', keys.publicKey, keys.privateKey);
  const { data, error } = await db.rpc('app_cpe_push_claim', { p_dispatch_token: dispatchToken, p_limit: 50 });
  if (error) return new Response('Queue unavailable', { status: 500 });
  let sent = 0;
  for (const row of data?.rows || []) {
    let status = 500;
    try {
      const result = await webpush.sendNotification({ endpoint: row.endpoint, keys: row.keys }, JSON.stringify({
        title: row.title, body: row.body, notificationId: row.notificationId,
        targetTab: row.targetTab, eventType: row.eventType
      }), { TTL: 86400 });
      status = result.statusCode;
      if (status >= 200 && status < 300) sent++;
    } catch (caught) {
      status = typeof caught?.statusCode === 'number' ? caught.statusCode : 500;
    }
    await db.rpc('app_cpe_push_finish', { p_dispatch_token: dispatchToken, p_id: row.id, p_status: status });
  }
  return Response.json({ processed: data?.rows?.length || 0, sent });
});
