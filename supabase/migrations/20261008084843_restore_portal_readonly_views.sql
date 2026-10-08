-- Restore access to each signed-in user's saved portal data for the legacy UI.
-- Both functions validate the app session and filter by the user's own chapa.
-- Portal refresh and worker functions remain disabled.
grant execute on function public.app_cpe_get_portal_snapshot(text)
  to anon, authenticated;

grant execute on function public.app_cpe_get_portal_document(text, text, text)
  to anon, authenticated;
