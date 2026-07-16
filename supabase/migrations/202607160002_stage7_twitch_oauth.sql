begin;

create table private.oauth_flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'twitch'),
  state_hash text not null check (state_hash ~ '^[a-f0-9]{64}$'),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  status text not null default 'pending'
    check (status in ('pending', 'exchanging', 'completed', 'consumed', 'failed')),
  provider_account_id uuid,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  consumed_at timestamptz,
  constraint oauth_flows_state_unique unique (state_hash),
  constraint oauth_flows_account_fk foreign key (user_id, provider_account_id)
    references public.provider_accounts(user_id, id) on delete cascade
);

alter table private.oauth_flows enable row level security;
alter table private.oauth_flows force row level security;
alter table private.oauth_token_secrets
  add column refresh_lease_owner uuid,
  add column refresh_lease_until timestamptz;

create index oauth_flows_user_status_idx
  on private.oauth_flows(user_id, status, expires_at desc);
create index provider_accounts_user_status_idx
  on public.provider_accounts(user_id, token_status);

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
  update private.oauth_flows as f set status = 'failed'
    where f.user_id = p_user_id and f.provider = 'twitch'
      and f.status in ('pending', 'exchanging');
  return query
    insert into private.oauth_flows(user_id, provider, state_hash, code_challenge)
    values (p_user_id, 'twitch', p_state_hash, p_code_challenge)
    returning id, private.oauth_flows.expires_at;
end;
$$;

create or replace function public.stage7_claim_twitch_oauth_callback(p_state_hash text)
returns table(flow_id uuid, user_id uuid, code_challenge text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update private.oauth_flows
      set status = 'exchanging'
      where state_hash = p_state_hash and status = 'pending' and expires_at > now()
      returning id, private.oauth_flows.user_id, private.oauth_flows.code_challenge;
end;
$$;

create or replace function public.stage7_complete_twitch_oauth(
  p_flow_id uuid,
  p_user_id uuid,
  p_provider_user_id text,
  p_display_name text,
  p_scopes text[],
  p_ciphertext bytea,
  p_key_version smallint,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  if not exists (
    select 1 from private.oauth_flows
      where id = p_flow_id and user_id = p_user_id and status = 'exchanging' and expires_at > now()
  ) then
    raise exception using errcode = '40001', message = 'oauth flow is not exchangeable';
  end if;

  insert into public.provider_accounts(
    user_id, provider, provider_user_id, display_name, scopes, token_status
  ) values (
    p_user_id, 'twitch', p_provider_user_id, p_display_name, p_scopes, 'active'
  )
  on conflict (user_id, provider) do update set
    provider_user_id = excluded.provider_user_id,
    display_name = excluded.display_name,
    scopes = excluded.scopes,
    token_status = 'active',
    updated_at = statement_timestamp()
  returning id into v_account_id;

  insert into private.oauth_token_secrets(
    user_id, provider_account_id, ciphertext, key_version, expires_at
  ) values (
    p_user_id, v_account_id, p_ciphertext, p_key_version, p_expires_at
  )
  on conflict (user_id, provider_account_id) do update set
    ciphertext = excluded.ciphertext,
    key_version = excluded.key_version,
    expires_at = excluded.expires_at,
    refresh_lease_owner = null,
    refresh_lease_until = null,
    updated_at = statement_timestamp();

  update private.oauth_flows set
    status = 'completed', provider_account_id = v_account_id, completed_at = statement_timestamp()
    where id = p_flow_id;
  return v_account_id;
end;
$$;

create or replace function public.stage7_finalize_twitch_oauth(
  p_user_id uuid,
  p_flow_id uuid,
  p_code_challenge text
)
returns table(
  provider_user_id text,
  display_name text,
  scopes text[],
  token_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.oauth_flows set status = 'consumed', consumed_at = statement_timestamp()
    where id = p_flow_id and user_id = p_user_id and status = 'completed'
      and expires_at > now() and code_challenge = p_code_challenge;
  if not found then
    raise exception using errcode = '40001', message = 'oauth finalization rejected';
  end if;
  return query
    select a.provider_user_id, a.display_name, a.scopes, s.expires_at
      from private.oauth_flows f
      join public.provider_accounts a on a.id = f.provider_account_id and a.user_id = f.user_id
      join private.oauth_token_secrets s on s.provider_account_id = a.id and s.user_id = a.user_id
      where f.id = p_flow_id and f.user_id = p_user_id;
end;
$$;

create or replace function public.stage7_get_twitch_status(p_user_id uuid)
returns table(provider_user_id text, display_name text, scopes text[], token_expires_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select a.provider_user_id, a.display_name, a.scopes, s.expires_at
    from public.provider_accounts a
    join private.oauth_token_secrets s on s.provider_account_id = a.id and s.user_id = a.user_id
    where a.user_id = p_user_id and a.provider = 'twitch' and a.token_status = 'active'
    limit 1;
$$;

create or replace function public.stage7_get_twitch_token(p_user_id uuid)
returns table(ciphertext bytea, key_version smallint, token_revision bigint, expires_at timestamptz)
language sql
security definer
set search_path = ''
stable
as $$
  select s.ciphertext, s.key_version, s.revision, s.expires_at
    from private.oauth_token_secrets s
    join public.provider_accounts a on a.id = s.provider_account_id and a.user_id = s.user_id
    where s.user_id = p_user_id and a.provider = 'twitch' and a.token_status = 'active'
    limit 1;
$$;

create or replace function public.stage7_claim_twitch_refresh(p_user_id uuid, p_lease_owner uuid)
returns table(ciphertext bytea, key_version smallint, token_revision bigint)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update private.oauth_token_secrets s set
      refresh_lease_owner = p_lease_owner,
      refresh_lease_until = statement_timestamp() + interval '30 seconds'
    from public.provider_accounts a
    where s.user_id = p_user_id and a.id = s.provider_account_id and a.user_id = s.user_id
      and a.provider = 'twitch' and a.token_status = 'active'
      and (s.refresh_lease_until is null or s.refresh_lease_until <= statement_timestamp())
    returning s.ciphertext, s.key_version, s.revision;
end;
$$;

create or replace function public.stage7_complete_twitch_refresh(
  p_user_id uuid,
  p_lease_owner uuid,
  p_expected_revision bigint,
  p_ciphertext bytea,
  p_key_version smallint,
  p_expires_at timestamptz,
  p_scopes text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.oauth_token_secrets s set
    ciphertext = p_ciphertext,
    key_version = p_key_version,
    expires_at = p_expires_at,
    refresh_lease_owner = null,
    refresh_lease_until = null,
    updated_at = statement_timestamp()
  from public.provider_accounts a
  where s.user_id = p_user_id and a.id = s.provider_account_id and a.user_id = s.user_id
    and a.provider = 'twitch' and s.revision = p_expected_revision
    and s.refresh_lease_owner = p_lease_owner and s.refresh_lease_until > statement_timestamp();
  if not found then return false; end if;
  update public.provider_accounts set scopes = p_scopes, token_status = 'active'
    where user_id = p_user_id and provider = 'twitch';
  return true;
end;
$$;

create or replace function public.stage7_revoke_twitch(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.oauth_token_secrets where user_id = p_user_id;
  update public.provider_accounts set token_status = 'revoked', updated_at = statement_timestamp()
    where user_id = p_user_id and provider = 'twitch';
  update private.oauth_flows set status = 'failed'
    where user_id = p_user_id and provider = 'twitch' and status <> 'consumed';
  return true;
end;
$$;

do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.stage7_begin_twitch_oauth(uuid,text,text)',
    'public.stage7_claim_twitch_oauth_callback(text)',
    'public.stage7_complete_twitch_oauth(uuid,uuid,text,text,text[],bytea,smallint,timestamptz)',
    'public.stage7_finalize_twitch_oauth(uuid,uuid,text)',
    'public.stage7_get_twitch_status(uuid)',
    'public.stage7_get_twitch_token(uuid)',
    'public.stage7_claim_twitch_refresh(uuid,uuid)',
    'public.stage7_complete_twitch_refresh(uuid,uuid,bigint,bytea,smallint,timestamptz,text[])',
    'public.stage7_revoke_twitch(uuid)'
  ] loop
    execute 'revoke all on function ' || function_signature || ' from public, anon, authenticated';
    execute 'grant execute on function ' || function_signature || ' to service_role';
  end loop;
end;
$$;

commit;
