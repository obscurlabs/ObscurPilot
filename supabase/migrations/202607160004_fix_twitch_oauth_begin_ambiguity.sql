create or replace function public.stage7_begin_twitch_oauth(
  p_user_id uuid,
  p_state_hash text,
  p_code_challenge text
)
returns table(flow_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users as u where u.id = p_user_id) then
    raise exception using errcode = '22023', message = 'invalid user';
  end if;

  delete from private.oauth_flows as f
    where f.user_id = p_user_id and f.provider = 'twitch'
      and (f.expires_at <= now() or f.status in ('consumed', 'failed'));

  update private.oauth_flows as f
    set status = 'failed'
    where f.user_id = p_user_id and f.provider = 'twitch'
      and f.status in ('pending', 'exchanging');

  return query
    insert into private.oauth_flows(user_id, provider, state_hash, code_challenge)
    values (p_user_id, 'twitch', p_state_hash, p_code_challenge)
    returning private.oauth_flows.id, private.oauth_flows.expires_at;
end;
$$;

revoke all on function public.stage7_begin_twitch_oauth(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.stage7_begin_twitch_oauth(uuid, text, text) to service_role;
