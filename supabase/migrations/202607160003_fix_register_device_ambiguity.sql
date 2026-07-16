create or replace function public.register_device(
  p_public_id uuid,
  p_name text,
  p_platform text,
  p_app_version text
)
returns table(id uuid, public_id uuid, revision bigint, last_seen_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  return query
  insert into public.devices(user_id, public_id, name, platform, app_version)
  values (v_user_id, p_public_id, p_name, p_platform, p_app_version)
  on conflict on constraint devices_user_public_unique do update
    set name = excluded.name,
        platform = excluded.platform,
        app_version = excluded.app_version,
        last_seen_at = statement_timestamp()
    where public.devices.revoked_at is null
  returning public.devices.id, public.devices.public_id,
            public.devices.revision, public.devices.last_seen_at;

  if not found then
    raise exception 'device revoked' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public.register_device(uuid, text, text, text) from public, anon;
grant execute on function public.register_device(uuid, text, text, text) to authenticated;
