begin;

create or replace function private.ensure_default_control_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid;
begin
  if p_user_id is null then
    raise exception 'user id is required' using errcode = '22023';
  end if;

  select profile.id into v_profile_id
  from public.control_profiles as profile
  where profile.user_id = p_user_id and profile.is_active
  limit 1;

  if v_profile_id is null then
    insert into public.control_profiles(user_id, name, schema_version, configuration, is_active)
    values (p_user_id, 'Default', 1, '{"source":"stage9-default-v1"}'::jsonb, true)
    on conflict (user_id, name) do update
      set is_active = true,
          schema_version = greatest(public.control_profiles.schema_version, 1)
    returning id into v_profile_id;
  end if;

  insert into public.tool_grants(
    user_id, control_profile_id, tool_name, risk_tier, confirmation_mode, constraints
  )
  select p_user_id, v_profile_id, grant_row.tool_name, grant_row.risk_tier,
         grant_row.confirmation_mode, grant_row.constraints
  from (values
    ('obs.read_snapshot', 0::smallint, 'never', '{"scopes":["obs:read"]}'::jsonb),
    ('obs.set_program_scene', 1::smallint, 'never', '{"scopes":["obs:scene:write"]}'::jsonb),
    ('obs.set_input_mute', 1::smallint, 'never', '{"scopes":["obs:audio:write"]}'::jsonb),
    ('obs.start_stream', 2::smallint, 'always', '{"scopes":["obs:stream:write"]}'::jsonb),
    ('obs.stop_stream', 2::smallint, 'always', '{"scopes":["obs:stream:write"]}'::jsonb),
    ('obs.start_record', 2::smallint, 'always', '{"scopes":["obs:record:write"]}'::jsonb),
    ('obs.stop_record', 2::smallint, 'always', '{"scopes":["obs:record:write"]}'::jsonb),
    ('twitch.read_connection', 0::smallint, 'never', '{"scopes":["twitch:read"]}'::jsonb)
  ) as grant_row(tool_name, risk_tier, confirmation_mode, constraints)
  on conflict (user_id, control_profile_id, tool_name) do nothing;
end;
$$;

revoke execute on function private.ensure_default_control_profile(uuid)
  from public, anon, authenticated;

create or replace function private.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, user_id)
  values (new.id, new.id)
  on conflict (id) do nothing;
  perform private.ensure_default_control_profile(new.id);
  return new;
end;
$$;

do $$
declare
  v_user_id uuid;
begin
  for v_user_id in select id from auth.users loop
    perform private.ensure_default_control_profile(v_user_id);
  end loop;
end;
$$;

commit;
