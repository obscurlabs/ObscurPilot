begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from anon, authenticated;

create or replace function private.touch_mutable_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  new.revision := old.revision + 1;
  return new;
end;
$$;

revoke execute on function private.touch_mutable_row() from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Creator' check (char_length(display_name) between 1 and 80),
  locale text not null default 'en-US' check (char_length(locale) between 2 and 35),
  time_zone text not null default 'UTC' check (char_length(time_zone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint profiles_identity_match check (id = user_id),
  constraint profiles_tenant_identity_unique unique (user_id, id)
);

create table public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  public_id uuid not null,
  name text not null check (char_length(name) between 1 and 80),
  platform text not null check (platform in ('win32', 'darwin', 'linux')),
  app_version text not null check (char_length(app_version) between 1 and 32),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint devices_user_public_unique unique (user_id, public_id),
  constraint devices_tenant_identity_unique unique (user_id, id)
);

create table public.provider_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('twitch')),
  provider_user_id text not null check (char_length(provider_user_id) between 1 and 128),
  display_name text not null check (char_length(display_name) between 1 and 80),
  scopes text[] not null default '{}',
  token_status text not null default 'active' check (token_status in ('active', 'refresh_required', 'revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint provider_accounts_user_provider_unique unique (user_id, provider),
  constraint provider_accounts_tenant_identity_unique unique (user_id, id)
);

create table private.oauth_token_secrets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_account_id uuid not null,
  ciphertext bytea not null check (octet_length(ciphertext) between 16 and 32768),
  key_version smallint not null check (key_version > 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint oauth_token_account_fk foreign key (user_id, provider_account_id)
    references public.provider_accounts(user_id, id) on delete cascade,
  constraint oauth_token_account_unique unique (user_id, provider_account_id)
);

create table public.obs_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid not null,
  label text not null check (char_length(label) between 1 and 80),
  host text not null default '127.0.0.1' check (host in ('127.0.0.1', 'localhost')),
  port integer not null default 4455 check (port between 1 and 65535),
  tls boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint obs_endpoints_device_fk foreign key (user_id, device_id)
    references public.devices(user_id, id) on delete cascade,
  constraint obs_endpoints_device_unique unique (user_id, device_id)
);

create table public.control_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  schema_version integer not null default 1 check (schema_version > 0),
  configuration jsonb not null default '{}'::jsonb
    check (jsonb_typeof(configuration) = 'object' and pg_column_size(configuration) <= 65536),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint control_profiles_user_name_unique unique (user_id, name),
  constraint control_profiles_tenant_identity_unique unique (user_id, id)
);

create unique index control_profiles_one_active_idx
  on public.control_profiles(user_id) where is_active;

create table public.tool_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  control_profile_id uuid not null,
  tool_name text not null check (char_length(tool_name) between 1 and 96),
  risk_tier smallint not null check (risk_tier between 0 and 3),
  confirmation_mode text not null check (confirmation_mode in ('always', 'session', 'never')),
  constraints jsonb not null default '{}'::jsonb
    check (jsonb_typeof(constraints) = 'object' and pg_column_size(constraints) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint tool_grants_profile_fk foreign key (user_id, control_profile_id)
    references public.control_profiles(user_id, id) on delete cascade,
  constraint tool_grants_profile_tool_unique unique (user_id, control_profile_id, tool_name)
);

create table public.event_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_account_id uuid not null,
  subscription_type text not null check (char_length(subscription_type) between 1 and 128),
  remote_subscription_id text check (remote_subscription_id is null or char_length(remote_subscription_id) <= 128),
  status text not null default 'pending' check (status in ('pending', 'enabled', 'revoked', 'failed')),
  condition jsonb not null default '{}'::jsonb
    check (jsonb_typeof(condition) = 'object' and pg_column_size(condition) <= 32768),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision > 0),
  constraint event_subscriptions_account_fk foreign key (user_id, provider_account_id)
    references public.provider_accounts(user_id, id) on delete cascade,
  constraint event_subscription_unique unique (user_id, provider_account_id, subscription_type)
);

create table public.session_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  close_reason text check (close_reason is null or char_length(close_reason) <= 96),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 32768),
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  constraint session_records_tenant_identity_unique unique (user_id, id),
  constraint session_records_device_fk foreign key (user_id, device_id)
    references public.devices(user_id, id) on delete set null (device_id)
);

create table public.command_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid,
  session_id uuid,
  correlation_id uuid not null,
  tool_name text not null check (char_length(tool_name) between 1 and 96),
  outcome text not null check (outcome in ('allowed', 'denied', 'failed', 'cancelled')),
  reason_code text not null check (char_length(reason_code) between 1 and 96),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 600000),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 32768),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint command_audit_device_fk foreign key (user_id, device_id)
    references public.devices(user_id, id) on delete set null (device_id),
  constraint command_audit_session_fk foreign key (user_id, session_id)
    references public.session_records(user_id, id) on delete set null (session_id),
  constraint command_audit_idempotency unique (user_id, correlation_id)
);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid,
  event_type text not null check (char_length(event_type) between 1 and 96),
  source text not null check (char_length(source) between 1 and 64),
  summary text not null check (char_length(summary) between 1 and 512),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 32768),
  occurred_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  constraint activity_events_tenant_identity_unique unique (user_id, id),
  constraint activity_events_device_fk foreign key (user_id, device_id)
    references public.devices(user_id, id) on delete set null (device_id)
);

create table public.feedback_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_event_id uuid,
  rating smallint not null check (rating between -1 and 1),
  reason_code text not null check (char_length(reason_code) between 1 and 96),
  comment text check (comment is null or char_length(comment) <= 1000),
  consent_scope text not null default 'quality' check (consent_scope in ('quality', 'learning')),
  expires_at timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now(),
  constraint feedback_source_fk foreign key (user_id, source_event_id)
    references public.activity_events(user_id, id) on delete set null (source_event_id)
);

create table private.client_mutations (
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  mutation_type text not null check (char_length(mutation_type) between 1 and 96),
  input_hash text not null check (char_length(input_hash) = 64),
  result jsonb not null check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 65536),
  processed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, idempotency_key)
);

create table private.sync_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  aggregate_type text not null check (char_length(aggregate_type) between 1 and 96),
  aggregate_id uuid not null,
  event_type text not null check (char_length(event_type) between 1 and 96),
  schema_version integer not null check (schema_version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 65536),
  attempts integer not null default 0 check (attempts between 0 and 100),
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'cancelled', 'processing', 'completed', 'failed')),
  requested_at timestamptz not null default now(),
  execute_after timestamptz not null default (now() + interval '7 days'),
  processing_started_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  last_error_code text check (last_error_code is null or char_length(last_error_code) <= 96),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index account_deletion_one_pending_idx
  on public.account_deletion_requests(user_id) where status = 'pending';

create index devices_user_updated_idx on public.devices(user_id, updated_at desc);
create index provider_accounts_user_updated_idx on public.provider_accounts(user_id, updated_at desc);
create index control_profiles_user_updated_idx on public.control_profiles(user_id, updated_at desc);
create index tool_grants_user_updated_idx on public.tool_grants(user_id, updated_at desc);
create index event_subscriptions_user_updated_idx on public.event_subscriptions(user_id, updated_at desc);
create index session_records_user_started_idx on public.session_records(user_id, started_at desc);
create index session_records_expiry_idx on public.session_records(expires_at);
create index command_audit_user_occurred_idx on public.command_audit(user_id, occurred_at desc, id);
create index activity_events_user_cursor_idx on public.activity_events(user_id, occurred_at, id);
create index activity_events_expiry_idx on public.activity_events(expires_at);
create index feedback_records_user_created_idx on public.feedback_records(user_id, created_at desc);
create index feedback_records_expiry_idx on public.feedback_records(expires_at);
create index sync_outbox_pending_idx on private.sync_outbox(next_attempt_at, id) where processed_at is null;
create index deletion_due_idx
  on public.account_deletion_requests(next_attempt_at, execute_after, id)
  where status = 'pending';
create index deletion_processing_lease_idx
  on public.account_deletion_requests(processing_started_at, id)
  where status = 'processing';

create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_mutable_row();
create trigger devices_touch before update on public.devices
  for each row execute function private.touch_mutable_row();
create trigger provider_accounts_touch before update on public.provider_accounts
  for each row execute function private.touch_mutable_row();
create trigger oauth_token_secrets_touch before update on private.oauth_token_secrets
  for each row execute function private.touch_mutable_row();
create trigger obs_endpoints_touch before update on public.obs_endpoints
  for each row execute function private.touch_mutable_row();
create trigger control_profiles_touch before update on public.control_profiles
  for each row execute function private.touch_mutable_row();
create trigger tool_grants_touch before update on public.tool_grants
  for each row execute function private.touch_mutable_row();
create trigger event_subscriptions_touch before update on public.event_subscriptions
  for each row execute function private.touch_mutable_row();

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
  return new;
end;
$$;

revoke execute on function private.create_profile_for_auth_user() from public, anon, authenticated;

create trigger auth_user_profile_created
  after insert on auth.users
  for each row execute function private.create_profile_for_auth_user();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'devices', 'provider_accounts', 'obs_endpoints', 'control_profiles',
    'tool_grants', 'event_subscriptions', 'session_records', 'command_audit',
    'activity_events', 'feedback_records', 'account_deletion_requests'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end;
$$;

alter table private.oauth_token_secrets enable row level security;
alter table private.oauth_token_secrets force row level security;
alter table private.client_mutations enable row level security;
alter table private.client_mutations force row level security;
alter table private.sync_outbox enable row level security;
alter table private.sync_outbox force row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'provider_accounts', 'obs_endpoints', 'control_profiles',
    'tool_grants', 'event_subscriptions'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_select_own', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      table_name || '_insert_own', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name || '_update_own', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      table_name || '_delete_own', table_name
    );
  end loop;
end;
$$;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy devices_select_own on public.devices
  for select to authenticated using ((select auth.uid()) = user_id);

create policy session_records_select_own on public.session_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy session_records_insert_own on public.session_records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy session_records_update_own on public.session_records
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy command_audit_select_own on public.command_audit
  for select to authenticated using ((select auth.uid()) = user_id);
create policy command_audit_insert_own on public.command_audit
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy activity_events_select_own on public.activity_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy activity_events_insert_own on public.activity_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy activity_events_delete_own on public.activity_events
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy feedback_records_select_own on public.feedback_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy feedback_records_insert_own on public.feedback_records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy feedback_records_delete_own on public.feedback_records
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy account_deletion_select_own on public.account_deletion_requests
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on all tables in schema public from anon;
revoke all on all tables in schema private from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.devices to authenticated;
grant select, insert, update, delete on public.provider_accounts to authenticated;
grant select, insert, update, delete on public.obs_endpoints to authenticated;
grant select, insert, update, delete on public.control_profiles to authenticated;
grant select, insert, update, delete on public.tool_grants to authenticated;
grant select, insert, update, delete on public.event_subscriptions to authenticated;
grant select, insert, update on public.session_records to authenticated;
grant select, insert on public.command_audit to authenticated;
grant select, insert, delete on public.activity_events to authenticated;
grant select, insert, delete on public.feedback_records to authenticated;
grant select on public.account_deletion_requests to authenticated;

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

create or replace function public.update_creator_profile(
  p_idempotency_key uuid,
  p_expected_revision bigint,
  p_display_name text,
  p_locale text,
  p_time_zone text
)
returns table(
  id uuid,
  user_id uuid,
  display_name text,
  locale text,
  time_zone text,
  revision bigint,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_input_hash text;
  v_stored_hash text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_input_hash := encode(
    sha256(convert_to(
      p_expected_revision::text || chr(31) || p_display_name || chr(31) ||
      p_locale || chr(31) || p_time_zone,
      'utf8'
    )),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text || p_idempotency_key::text, 0));

  select m.input_hash, m.result into v_stored_hash, v_result
  from private.client_mutations as m
  where m.user_id = v_user_id and m.idempotency_key = p_idempotency_key;

  if found then
    if v_stored_hash <> v_input_hash then
      raise exception 'idempotency key reused with different input' using errcode = '23514';
    end if;
    return query
      select r.id, r.user_id, r.display_name, r.locale, r.time_zone, r.revision, r.updated_at
      from jsonb_to_record(v_result) as r(
        id uuid, user_id uuid, display_name text, locale text, time_zone text,
        revision bigint, updated_at timestamptz
      );
    return;
  end if;

  update public.profiles as p
  set display_name = p_display_name,
      locale = p_locale,
      time_zone = p_time_zone
  where p.user_id = v_user_id and p.revision = p_expected_revision
  returning jsonb_build_object(
    'id', p.id,
    'user_id', p.user_id,
    'display_name', p.display_name,
    'locale', p.locale,
    'time_zone', p.time_zone,
    'revision', p.revision,
    'updated_at', p.updated_at
  ) into v_result;

  if not found then
    return;
  end if;

  insert into private.client_mutations(
    user_id, idempotency_key, mutation_type, input_hash, result
  ) values (
    v_user_id, p_idempotency_key, 'profile.update', v_input_hash, v_result
  );

  return query
    select r.id, r.user_id, r.display_name, r.locale, r.time_zone, r.revision, r.updated_at
    from jsonb_to_record(v_result) as r(
      id uuid, user_id uuid, display_name text, locale text, time_zone text,
      revision bigint, updated_at timestamptz
    );
end;
$$;

create or replace function public.request_account_deletion()
returns table(request_id uuid, requested_at timestamptz, execute_after timestamptz)
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
  insert into public.account_deletion_requests(user_id)
  values (v_user_id)
  on conflict (user_id) where status = 'pending'
  do update set requested_at = public.account_deletion_requests.requested_at
  returning public.account_deletion_requests.id,
            public.account_deletion_requests.requested_at,
            public.account_deletion_requests.execute_after;
end;
$$;

create or replace function public.claim_account_deletions(
  p_limit integer default 25,
  p_lease_seconds integer default 900
)
returns table(request_id uuid, user_id uuid, attempts integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 100 or p_lease_seconds < 60 or p_lease_seconds > 3600 then
    raise exception 'invalid deletion claim parameters' using errcode = '22023';
  end if;

  update public.account_deletion_requests as stale
  set status = 'pending',
      processing_started_at = null,
      next_attempt_at = statement_timestamp(),
      last_error_code = 'LEASE_EXPIRED'
  where stale.status = 'processing'
    and stale.processing_started_at <
      statement_timestamp() - make_interval(secs => p_lease_seconds);

  return query
  with candidates as (
    select request.id
    from public.account_deletion_requests as request
    where request.status = 'pending'
      and request.execute_after <= statement_timestamp()
      and request.next_attempt_at <= statement_timestamp()
      and request.attempts < 10
    order by request.next_attempt_at, request.execute_after, request.id
    for update skip locked
    limit p_limit
  )
  update public.account_deletion_requests as claimed
  set status = 'processing',
      processing_started_at = statement_timestamp(),
      attempts = claimed.attempts + 1,
      last_error_code = null
  from candidates
  where claimed.id = candidates.id
  returning claimed.id, claimed.user_id, claimed.attempts;
end;
$$;

create or replace function public.release_account_deletion(
  p_request_id uuid,
  p_error_code text,
  p_retry_delay_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if p_error_code is null
    or char_length(p_error_code) not between 1 and 96
    or p_retry_delay_seconds < 1
    or p_retry_delay_seconds > 86400 then
    raise exception 'invalid deletion retry parameters' using errcode = '22023';
  end if;

  update public.account_deletion_requests as request
  set status = case when request.attempts >= 10 then 'failed' else 'pending' end,
      processing_started_at = null,
      next_attempt_at = statement_timestamp() + make_interval(secs => p_retry_delay_seconds),
      last_error_code = p_error_code
  where request.id = p_request_id and request.status = 'processing';
  v_updated := found;
  return v_updated;
end;
$$;

create or replace function private.purge_expired_content(p_batch_size integer default 500)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
  v_count integer := 0;
begin
  if p_batch_size < 1 or p_batch_size > 5000 then
    raise exception 'invalid batch size' using errcode = '22023';
  end if;

  with targets as (
    select id from public.activity_events where expires_at <= now()
    order by expires_at limit p_batch_size
  )
  delete from public.activity_events where id in (select id from targets);
  get diagnostics v_count = row_count;
  v_deleted := v_deleted + v_count;

  with targets as (
    select id from public.feedback_records where expires_at <= now()
    order by expires_at limit p_batch_size
  )
  delete from public.feedback_records where id in (select id from targets);
  get diagnostics v_count = row_count;
  v_deleted := v_deleted + v_count;

  with targets as (
    select id from public.session_records where expires_at <= now()
    order by expires_at limit p_batch_size
  )
  delete from public.session_records where id in (select id from targets);
  get diagnostics v_count = row_count;
  return v_deleted + v_count;
end;
$$;

create or replace function public.run_retention_maintenance(p_batch_size integer default 500)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.purge_expired_content(p_batch_size);
$$;

revoke execute on function public.register_device(uuid, text, text, text) from public, anon;
revoke execute on function public.update_creator_profile(uuid, bigint, text, text, text) from public, anon;
revoke execute on function public.request_account_deletion() from public, anon;
revoke execute on function public.claim_account_deletions(integer, integer) from public, anon, authenticated;
revoke execute on function public.release_account_deletion(uuid, text, integer) from public, anon, authenticated;
revoke execute on function private.purge_expired_content(integer) from public, anon, authenticated;
revoke execute on function public.run_retention_maintenance(integer) from public, anon, authenticated;

grant execute on function public.register_device(uuid, text, text, text) to authenticated;
grant execute on function public.update_creator_profile(uuid, bigint, text, text, text) to authenticated;
grant execute on function public.request_account_deletion() to authenticated;
grant execute on function public.claim_account_deletions(integer, integer) to service_role;
grant execute on function public.release_account_deletion(uuid, text, integer) to service_role;
grant execute on function private.purge_expired_content(integer) to service_role;
grant execute on function public.run_retention_maintenance(integer) to service_role;

alter publication supabase_realtime add table
  public.profiles,
  public.devices,
  public.control_profiles,
  public.tool_grants;

commit;
