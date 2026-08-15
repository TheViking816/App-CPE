insert into public.app_cpe_specialty_complements (
  specialty_key,
  specialty_name,
  amount,
  enabled,
  notes,
  updated_at
)
values
  ('CAPATAZ', 'Capataz', 86.48, true, 'Complemento de puesto 2026', now()),
  ('SOBORDISTA', 'Sobordista', 74.89, true, 'Complemento de puesto 2026', now()),
  ('TRINCADOR', 'Trincador', 48.21, true, 'Complemento de puesto 2026', now()),
  ('CLASIFICADOR', 'Clasificador', 74.89, true, 'Complemento de puesto 2026', now()),
  ('MAFI', 'Mafi', 74.89, true, 'Complemento de puesto 2026', now()),
  ('MANIPULADOR_OP_UNICA', 'Manipulador op. unica', 56.96, true, 'Complemento de puesto 2026', now()),
  ('APOYO_OPERACION', 'Apoyo operacion', 113.92, true, 'Complemento de puesto 2026', now()),
  ('CONDUCTOR_1A', 'Conductor 1a', 7.38, true, 'Complemento de puesto 2026', now()),
  ('GARAJISTA_RO_RO', 'Garajista Ro-Ro', 181.41, true, 'Complemento de puesto 2026', now()),
  ('FURGONETERO_RO_RO', 'Furgonetero Ro-Ro', 47.47, true, 'Complemento de puesto 2026', now()),
  ('CONDUCTOR_2A', 'Conductor 2a Ro-Ro', 6.94, true, 'Complemento de puesto 2026', now())
on conflict (specialty_key) do update
set specialty_name = excluded.specialty_name,
    amount = excluded.amount,
    enabled = excluded.enabled,
    notes = excluded.notes,
    updated_at = excluded.updated_at;
