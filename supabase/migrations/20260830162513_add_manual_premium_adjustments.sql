create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.app_cpe_manual_premiums (
  user_id uuid not null references public.app_cpe_users(id) on delete cascade,
  jornal_key text not null,
  amount numeric(10, 2) not null,
  portal_amount_at_edit numeric(10, 2),
  updated_at timestamptz not null default now(),
  primary key (user_id, jornal_key),
  constraint app_cpe_manual_premiums_key_length check (length(jornal_key) between 12 and 300),
  constraint app_cpe_manual_premiums_amount check (amount between 0 and 99999.99),
  constraint app_cpe_manual_premiums_portal_amount check (
    portal_amount_at_edit is null or portal_amount_at_edit between 0 and 99999.99
  )
);

alter table private.app_cpe_manual_premiums enable row level security;
revoke all on table private.app_cpe_manual_premiums from public, anon, authenticated;

create or replace function public.app_cpe_get_manual_premiums(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_premiums jsonb;
begin
  v_user := public.app_cpe_user_from_token(p_token);

  select coalesce(
    jsonb_object_agg(
      jornal_key,
      jsonb_build_object(
        'amount', amount,
        'portalAmountAtEdit', portal_amount_at_edit,
        'updatedAt', updated_at
      )
    ),
    '{}'::jsonb
  )
  into v_premiums
  from private.app_cpe_manual_premiums
  where user_id = v_user.id;

  return v_premiums;
end;
$$;

create or replace function public.app_cpe_set_manual_premium(
  p_token text,
  p_jornal_key text,
  p_amount numeric,
  p_portal_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog, pg_temp
as $$
declare
  v_user public.app_cpe_users;
  v_amount numeric(10, 2);
  v_portal_amount numeric(10, 2);
begin
  v_user := public.app_cpe_user_from_token(p_token);

  if length(coalesce(p_jornal_key, '')) < 12
    or length(p_jornal_key) > 300
    or p_jornal_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\|'
  then
    raise exception 'Jornal no valido';
  end if;

  if p_amount is null then
    delete from private.app_cpe_manual_premiums
    where user_id = v_user.id and jornal_key = p_jornal_key;

    return jsonb_build_object('ok', true, 'jornalKey', p_jornal_key, 'deleted', true);
  end if;

  v_amount := round(p_amount, 2);
  v_portal_amount := case when p_portal_amount is null then null else round(p_portal_amount, 2) end;

  if v_amount < 0 or v_amount > 99999.99 then
    raise exception 'La prima manual debe estar entre 0 y 99999,99 euros';
  end if;
  if v_portal_amount is not null and (v_portal_amount < 0 or v_portal_amount > 99999.99) then
    raise exception 'La prima del portal no es valida';
  end if;

  insert into private.app_cpe_manual_premiums (
    user_id, jornal_key, amount, portal_amount_at_edit, updated_at
  )
  values (v_user.id, p_jornal_key, v_amount, v_portal_amount, now())
  on conflict (user_id, jornal_key) do update
    set amount = excluded.amount,
        portal_amount_at_edit = excluded.portal_amount_at_edit,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'jornalKey', p_jornal_key,
    'amount', v_amount,
    'portalAmountAtEdit', v_portal_amount
  );
end;
$$;

revoke all on function public.app_cpe_get_manual_premiums(text) from public, anon, authenticated;
revoke all on function public.app_cpe_set_manual_premium(text, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.app_cpe_get_manual_premiums(text) to anon, authenticated;
grant execute on function public.app_cpe_set_manual_premium(text, text, numeric, numeric) to anon, authenticated;
