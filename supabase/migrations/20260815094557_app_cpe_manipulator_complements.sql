create table if not exists public.app_cpe_manipulator_complements (
  specialty_key text not null,
  operation_type text not null,
  rate_key text not null,
  shift_key text not null,
  amount numeric(10, 2) not null,
  enabled boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (specialty_key, operation_type, rate_key, shift_key),
  constraint app_cpe_manipulator_complements_specialty
    check (specialty_key in ('TRASTAINERS_RTT', 'CONTAINER', 'GRUAS', 'ELEVADORAS')),
  constraint app_cpe_manipulator_complements_operation
    check (operation_type in ('ESTIBA', 'RECEPCION_ENTREGA')),
  constraint app_cpe_manipulator_complements_rate
    check (rate_key in ('STANDARD', 'FESTIVO')),
  constraint app_cpe_manipulator_complements_shift
    check (shift_key in ('02-08', '08-14', '14-20', '20-02'))
);

alter table public.app_cpe_manipulator_complements enable row level security;

create policy "Public can read manipulator complements"
  on public.app_cpe_manipulator_complements for select
  to anon, authenticated
  using (true);

revoke all on table public.app_cpe_manipulator_complements from anon, authenticated;
grant select on table public.app_cpe_manipulator_complements to anon, authenticated;
grant all on table public.app_cpe_manipulator_complements to service_role;

insert into public.app_cpe_manipulator_complements
  (specialty_key, operation_type, rate_key, shift_key, amount, notes)
select
  specialty_key,
  operation_type,
  rate_key,
  shift_key,
  amount,
  'Complementos de manipuladores 2026'
from (values
  ('ESTIBA', 'STANDARD', '02-08', 84.29::numeric),
  ('ESTIBA', 'STANDARD', '08-14', 60.57::numeric),
  ('ESTIBA', 'STANDARD', '14-20', 60.57::numeric),
  ('ESTIBA', 'STANDARD', '20-02', 83.71::numeric),
  ('RECEPCION_ENTREGA', 'STANDARD', '02-08', 13.26::numeric),
  ('RECEPCION_ENTREGA', 'STANDARD', '08-14', 12.15::numeric),
  ('RECEPCION_ENTREGA', 'STANDARD', '14-20', 12.15::numeric),
  ('RECEPCION_ENTREGA', 'STANDARD', '20-02', 16.90::numeric),
  ('ESTIBA', 'FESTIVO', '02-08', 70.26::numeric),
  ('ESTIBA', 'FESTIVO', '08-14', 70.26::numeric),
  ('ESTIBA', 'FESTIVO', '14-20', 70.26::numeric),
  ('ESTIBA', 'FESTIVO', '20-02', 70.26::numeric),
  ('RECEPCION_ENTREGA', 'FESTIVO', '02-08', 70.26::numeric),
  ('RECEPCION_ENTREGA', 'FESTIVO', '08-14', 70.26::numeric),
  ('RECEPCION_ENTREGA', 'FESTIVO', '14-20', 70.26::numeric),
  ('RECEPCION_ENTREGA', 'FESTIVO', '20-02', 70.26::numeric)
) as rates(operation_type, rate_key, shift_key, amount)
cross join (values
  ('TRASTAINERS_RTT'),
  ('CONTAINER'),
  ('GRUAS'),
  ('ELEVADORAS')
) as specialties(specialty_key)
on conflict (specialty_key, operation_type, rate_key, shift_key) do update
set amount = excluded.amount,
    notes = excluded.notes,
    enabled = true,
    updated_at = now();
