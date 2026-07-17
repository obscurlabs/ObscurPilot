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
    values (
      p_user_id, 'Default', 1,
      jsonb_build_object('source', 'stage111-default-v1'),
      true
    )
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
    ('obs.read_snapshot', 0::smallint, 'never', jsonb_build_object('scopes', jsonb_build_array('obs:read'))),
    ('obs.set_program_scene', 1::smallint, 'never', jsonb_build_object('scopes', jsonb_build_array('obs:scene:write'))),
    ('obs.set_input_mute', 1::smallint, 'never', jsonb_build_object('scopes', jsonb_build_array('obs:audio:write'))),
    ('obs.start_stream', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('obs:stream:write'))),
    ('obs.stop_stream', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('obs:stream:write'))),
    ('obs.start_record', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('obs:record:write'))),
    ('obs.stop_record', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('obs:record:write'))),
    ('twitch.read_connection', 0::smallint, 'never', jsonb_build_object('scopes', jsonb_build_array('twitch:read'))),
    ('live_session.prepare_profile', 1::smallint, 'never', jsonb_build_object('scopes', jsonb_build_array('session:prepare'))),
    ('live_session.auto_prepare', 1::smallint, 'never', jsonb_build_object('scopes', jsonb_build_array('session:prepare'))),
    ('live_session.start_prepared', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('session:start'))),
    ('live_session.stop', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('session:stop'))),
    ('twitch.channel.update', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('twitch:channel:write'))),
    ('twitch.chat.send_message', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('twitch:chat:write'))),
    ('twitch.chat.delete_message', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('twitch:chat:moderate'))),
    ('twitch.moderation.timeout_user', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('twitch:moderate'))),
    ('twitch.moderation.ban_user', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('twitch:moderate'))),
    ('twitch.moderation.unban_user', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('twitch:moderate'))),
    ('twitch.user.block', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('twitch:user:block'))),
    ('twitch.user.unblock', 2::smallint, 'always', jsonb_build_object('scopes', jsonb_build_array('twitch:user:block')))
  ) as grant_row(tool_name, risk_tier, confirmation_mode, constraints)
  on conflict (user_id, control_profile_id, tool_name) do update
    set risk_tier = excluded.risk_tier,
        confirmation_mode = excluded.confirmation_mode,
        constraints = excluded.constraints,
        updated_at = now();
end;
$$;

revoke execute on function private.ensure_default_control_profile(uuid)
  from public, anon, authenticated;

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
