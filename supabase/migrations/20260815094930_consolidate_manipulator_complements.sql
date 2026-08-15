alter table public.app_cpe_specialty_complements
  add column if not exists servicio_publico_02_08 numeric(10, 2),
  add column if not exists servicio_publico_08_14 numeric(10, 2),
  add column if not exists servicio_publico_14_20 numeric(10, 2),
  add column if not exists servicio_publico_20_02 numeric(10, 2),
  add column if not exists recepcion_entrega_02_08 numeric(10, 2),
  add column if not exists recepcion_entrega_08_14 numeric(10, 2),
  add column if not exists recepcion_entrega_14_20 numeric(10, 2),
  add column if not exists recepcion_entrega_20_02 numeric(10, 2),
  add column if not exists festivo numeric(10, 2);

insert into public.app_cpe_specialty_complements (
  specialty_key,
  specialty_name,
  amount,
  servicio_publico_02_08,
  servicio_publico_08_14,
  servicio_publico_14_20,
  servicio_publico_20_02,
  recepcion_entrega_02_08,
  recepcion_entrega_08_14,
  recepcion_entrega_14_20,
  recepcion_entrega_20_02,
  festivo,
  enabled,
  notes
)
values
  ('TRASTAINERS_RTT', 'Trastainers RTT', null, 84.29, 60.57, 60.57, 83.71, 13.26, 12.15, 12.15, 16.90, 70.26, true, 'Complementos de manipuladores 2026'),
  ('CONTAINER', 'Containera', null, 84.29, 60.57, 60.57, 83.71, 13.26, 12.15, 12.15, 16.90, 70.26, true, 'Complementos de manipuladores 2026'),
  ('GRUAS', 'Gruas', null, 84.29, 60.57, 60.57, 83.71, 13.26, 12.15, 12.15, 16.90, 70.26, true, 'Complementos de manipuladores 2026'),
  ('ELEVADORAS', 'Elevadoras', null, 84.29, 60.57, 60.57, 83.71, 13.26, 12.15, 12.15, 16.90, 70.26, true, 'Complementos de manipuladores 2026')
on conflict (specialty_key) do update
set specialty_name = excluded.specialty_name,
    servicio_publico_02_08 = excluded.servicio_publico_02_08,
    servicio_publico_08_14 = excluded.servicio_publico_08_14,
    servicio_publico_14_20 = excluded.servicio_publico_14_20,
    servicio_publico_20_02 = excluded.servicio_publico_20_02,
    recepcion_entrega_02_08 = excluded.recepcion_entrega_02_08,
    recepcion_entrega_08_14 = excluded.recepcion_entrega_08_14,
    recepcion_entrega_14_20 = excluded.recepcion_entrega_14_20,
    recepcion_entrega_20_02 = excluded.recepcion_entrega_20_02,
    festivo = excluded.festivo,
    enabled = true,
    notes = excluded.notes,
    updated_at = now();

drop table if exists public.app_cpe_manipulator_complements;
