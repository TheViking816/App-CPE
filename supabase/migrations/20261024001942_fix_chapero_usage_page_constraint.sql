-- Keep the table allowlist aligned with app_cpe_track_page_visit.
alter table public.app_cpe_usage_events drop constraint app_cpe_usage_events_page_key_check;
alter table public.app_cpe_usage_events add constraint app_cpe_usage_events_page_key_check check (
page_key is null or page_key in (
'inicio','contratacion','sueldometro','descansos','excepciones','vacaciones','nominas','estado','puertas','chapero','censo','portal','tablon','enlaces','foro','conversaciones','cuenta','perfil'
));
