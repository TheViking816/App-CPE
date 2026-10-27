import { supabase } from './supabaseClient.js';

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
  return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
}

async function saveSubscription(token, subscription) {
  const { error } = await supabase.rpc('app_cpe_push_subscribe', { p_token: token, p_subscription: subscription.toJSON() });
  if (error) throw error;
}

export async function refreshPushSubscription(token) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false;
  return syncPushSubscription(token);
}

async function syncPushSubscription(token) {
  if (!supabase || !token || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  const { data: publicKey, error } = await supabase.rpc('app_cpe_push_public_key');
  if (error || !publicKey) return false;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    const { data: active, error: statusError } = await supabase.rpc('app_cpe_push_subscription_active', {
      p_token: token, p_endpoint: subscription.endpoint
    });
    if (statusError) throw statusError;
    if (!active) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeBase64Url(publicKey) });
  await saveSubscription(token, subscription);
  return true;
}

export async function enablePushNotifications(token) {
  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted' && await Notification.requestPermission() !== 'granted') return false;
  return syncPushSubscription(token);
}

export async function disablePushNotifications(token) {
  if (!supabase || !token || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await supabase.rpc('app_cpe_push_unsubscribe', { p_token: token, p_endpoint: subscription.endpoint });
  await subscription.unsubscribe();
}
