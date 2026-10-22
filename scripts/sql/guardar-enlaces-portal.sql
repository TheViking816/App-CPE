-- Ejecutar SOLO en el SQL Editor de App CPE, como administrador.
-- Primero inicia sesión manualmente con el usuario y obtén su enlace personal.
-- Sustituye los dos valores siguientes; no compartas el enlace con terceros.
begin;
do $$
declare
  v_chapa text := 'CAMBIA_CHAPA';
  v_url text := 'PEGA_AQUI_EL_ENLACE_PERSONAL_COMPLETO';
  v_usr text; v_rec text; v_pwd text; v_expected text;
begin
  if v_chapa !~ '^[0-9]{5}$' then raise exception 'Indica la chapa'; end if;
  if v_url !~ '^https://norayweb[.]cpevalencia[.]com/[a-z0-9-]+[?]cal=gwt&mode=PROD&req=login&usr=[0-9]{5}&rec=[1-9][0-9]{0,9}&pwd=[A-Fa-f0-9]{64}$' then raise exception 'Enlace personal no válido'; end if;
  v_usr:=substring(v_url from '&usr=([0-9]+)&');
  v_rec:=substring(v_url from '&rec=([0-9]+)&');
  v_pwd:=lower(substring(v_url from '&pwd=([A-Fa-f0-9]{64})$'));
  if v_usr is distinct from v_chapa then raise exception 'La chapa y el enlace no coinciden'; end if;
  select encode(extensions.digest(s.decrypted_secret,'sha256'),'hex') into v_expected
    from private.app_cpe_portal_link_requests r
    join vault.decrypted_secrets s on s.id=r.password_secret_id
    where r.chapa=v_chapa;
  if v_expected is null or v_expected is distinct from v_pwd then raise exception 'El pwd no corresponde a la contraseña guardada de esta cuenta'; end if;
  insert into private.app_cpe_manual_noray_section_links(chapa,section,registro,password_hash)
    select v_chapa,section,v_rec,v_pwd from unnest(array['dobles','vacaciones']) as section
    on conflict(chapa,section) do update set registro=excluded.registro,password_hash=excluded.password_hash,updated_at=now();
  insert into private.app_cpe_manual_donde_voy_links(chapa,registro,password_hash)
    values(v_chapa,v_rec,v_pwd)
    on conflict(chapa) do update set registro=excluded.registro,password_hash=excluded.password_hash,updated_at=now();
  update private.app_cpe_portal_link_requests set status='linked',updated_at=now() where chapa=v_chapa;
end $$;
commit;
