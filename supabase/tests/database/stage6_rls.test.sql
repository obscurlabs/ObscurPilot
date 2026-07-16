
begin;

create extension if not exists pgtap with schema extensions;
select plan(90);

select has_table('public', 'profiles', 'profiles exists');
select has_table('public', 'devices', 'devices exists');
select has_table('private', 'oauth_token_secrets', 'token custody table is private');
select has_function(
  'public',
  'update_creator_profile',
  array['uuid', 'bigint', 'text', 'text', 'text'],
  'revision/idempotency RPC exists'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'stage6-a@example.test', '',
    now(), jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}', now(), now()
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'stage6-b@example.test', '',
    now(), jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}', now(), now()
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'stage6-c@example.test', '',
    now(), jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
    '{}', now(), now()
  );

-- Seed user B's rows as the migration owner. User A creates every row for which
-- authenticated receives INSERT, proving both the positive grant and RLS check.
insert into public.devices(id, user_id, public_id, name, platform, app_version) values
  ('a1000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'A device', 'win32', '0.1.0'),
  ('b1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'b1100000-0000-4000-8000-000000000002', 'B device', 'win32', '0.1.0'),
  ('c1000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'c1100000-0000-4000-8000-000000000003', 'C device', 'win32', '0.1.0');
insert into public.provider_accounts(id, user_id, provider, provider_user_id, display_name) values
  ('b2000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'twitch', 'provider-b', 'Provider B');
insert into public.obs_endpoints(id, user_id, device_id, label) values
  ('b3000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'OBS B');
insert into public.control_profiles(id, user_id, name) values
  ('b4000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Profile B');
insert into public.tool_grants(id, user_id, control_profile_id, tool_name, risk_tier, confirmation_mode) values
  ('b5000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000002', 'tool.b', 1, 'always');
insert into public.event_subscriptions(id, user_id, provider_account_id, subscription_type) values
  ('b6000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'event.b');
insert into public.session_records(id, user_id, device_id) values
  ('b7000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002');
insert into public.command_audit(id, user_id, device_id, session_id, correlation_id, tool_name, outcome, reason_code) values
  ('b8000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-000000000002', 'tool.b', 'allowed', 'fixture');
insert into public.activity_events(id, user_id, device_id, event_type, source, summary) values
  ('b9000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'event.b', 'fixture', 'B activity');
insert into public.feedback_records(id, user_id, source_event_id, rating, reason_code) values
  ('ba000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'b9000000-0000-4000-8000-000000000002', 1, 'fixture');
insert into public.account_deletion_requests(id, user_id) values
  ('bb000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- Profiles and devices are read-only to authenticated. Their direct own and
-- foreign writes fail by privilege; scoped mutation RPCs are tested separately.
select throws_ok(statement, '42501', null, description)
from (
  values
    ($$insert into public.profiles(id, user_id) values ('10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001')$$, 'direct own profile insert is denied'),
    ($$insert into public.profiles(id, user_id) values ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003')$$, 'direct foreign profile insert is denied'),
    ($$update public.profiles set display_name = 'forbidden' where user_id = '10000000-0000-4000-8000-000000000001'$$, 'direct own profile update is denied'),
    ($$update public.profiles set display_name = 'forbidden' where user_id = '20000000-0000-4000-8000-000000000002'$$, 'direct foreign profile update is denied'),
    ($$delete from public.profiles where user_id = '10000000-0000-4000-8000-000000000001'$$, 'direct own profile delete is denied'),
    ($$delete from public.profiles where user_id = '20000000-0000-4000-8000-000000000002'$$, 'direct foreign profile delete is denied'),
    ($$insert into public.devices(user_id, public_id, name, platform, app_version) values ('10000000-0000-4000-8000-000000000001', 'a1200000-0000-4000-8000-000000000001', 'Direct A', 'win32', '0.1.0')$$, 'direct own device insert is denied'),
    ($$insert into public.devices(user_id, public_id, name, platform, app_version) values ('20000000-0000-4000-8000-000000000002', 'b1200000-0000-4000-8000-000000000002', 'Direct B', 'win32', '0.1.0')$$, 'direct foreign device insert is denied'),
    ($$update public.devices set name = 'forbidden' where id = 'a1000000-0000-4000-8000-000000000001'$$, 'direct own device update is denied'),
    ($$update public.devices set name = 'forbidden' where id = 'b1000000-0000-4000-8000-000000000002'$$, 'direct foreign device update is denied'),
    ($$delete from public.devices where id = 'a1000000-0000-4000-8000-000000000001'$$, 'direct own device delete is denied'),
    ($$delete from public.devices where id = 'b1000000-0000-4000-8000-000000000002'$$, 'direct foreign device delete is denied')
) as denied_writes(statement, description);

-- Exercise every direct INSERT grant with own-row success and foreign-row denial.
select lives_ok(own_statement, 'user A inserts own ' || label)
from (
  values
    (1, 'provider account', $$insert into public.provider_accounts(id, user_id, provider, provider_user_id, display_name) values ('a2000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'twitch', 'provider-a', 'Provider A')$$),
    (2, 'OBS endpoint', $$insert into public.obs_endpoints(id, user_id, device_id, label) values ('a3000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'OBS A')$$),
    (3, 'control profile', $$insert into public.control_profiles(id, user_id, name) values ('a4000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Profile A')$$),
    (4, 'tool grant', $$insert into public.tool_grants(id, user_id, control_profile_id, tool_name, risk_tier, confirmation_mode) values ('a5000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', 'tool.a', 1, 'always')$$),
    (5, 'event subscription', $$insert into public.event_subscriptions(id, user_id, provider_account_id, subscription_type) values ('a6000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'event.a')$$),
    (6, 'session record', $$insert into public.session_records(id, user_id, device_id) values ('a7000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001')$$),
    (7, 'command audit', $$insert into public.command_audit(id, user_id, device_id, session_id, correlation_id, tool_name, outcome, reason_code) values ('a8000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000001', 'a8100000-0000-4000-8000-000000000001', 'tool.a', 'allowed', 'fixture')$$),
    (8, 'activity event', $$insert into public.activity_events(id, user_id, device_id, event_type, source, summary) values ('a9000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'event.a', 'fixture', 'A activity')$$),
    (9, 'feedback record', $$insert into public.feedback_records(id, user_id, source_event_id, rating, reason_code) values ('aa000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001', 1, 'fixture')$$)
) as own_inserts(ordinal, label, own_statement)
order by ordinal;

select throws_ok(foreign_statement, '42501', null, 'user A cannot insert foreign ' || label)
from (
  values
    ('provider account', $$insert into public.provider_accounts(id, user_id, provider, provider_user_id, display_name) values ('c2000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'twitch', 'provider-c', 'Provider C')$$),
    ('OBS endpoint', $$insert into public.obs_endpoints(id, user_id, device_id, label) values ('c3000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000003', 'OBS C')$$),
    ('control profile', $$insert into public.control_profiles(id, user_id, name) values ('c4000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'Profile C')$$),
    ('tool grant', $$insert into public.tool_grants(id, user_id, control_profile_id, tool_name, risk_tier, confirmation_mode) values ('c5000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-000000000002', 'tool.c', 1, 'always')$$),
    ('event subscription', $$insert into public.event_subscriptions(id, user_id, provider_account_id, subscription_type) values ('c6000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002', 'event.c')$$),
    ('session record', $$insert into public.session_records(id, user_id, device_id) values ('c7000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002')$$),
    ('command audit', $$insert into public.command_audit(id, user_id, device_id, session_id, correlation_id, tool_name, outcome, reason_code) values ('c8000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-000000000002', 'c8100000-0000-4000-8000-000000000003', 'tool.c', 'allowed', 'fixture')$$),
    ('activity event', $$insert into public.activity_events(id, user_id, device_id, event_type, source, summary) values ('c9000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 'event.c', 'fixture', 'C activity')$$),
    ('feedback record', $$insert into public.feedback_records(id, user_id, source_event_id, rating, reason_code) values ('ca000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'b9000000-0000-4000-8000-000000000002', 1, 'fixture')$$)
) as foreign_inserts(label, foreign_statement);

select lives_ok(
  $$select * from public.request_account_deletion()$$,
  'user A creates its own deletion request only through the RPC'
);

-- Every public application table exposes only the authenticated tenant's rows.
select results_eq(
  format('select count(*) from public.%I where user_id = %L', table_name, '10000000-0000-4000-8000-000000000001'),
  array[1::bigint],
  'user A selects own ' || label
)
from (
  values
    ('profiles', 'profile'), ('devices', 'device'),
    ('provider_accounts', 'provider account'), ('obs_endpoints', 'OBS endpoint'),
    ('control_profiles', 'control profile'), ('tool_grants', 'tool grant'),
    ('event_subscriptions', 'event subscription'), ('session_records', 'session record'),
    ('command_audit', 'command audit'), ('activity_events', 'activity event'),
    ('feedback_records', 'feedback record'), ('account_deletion_requests', 'deletion request')
) as application_tables(table_name, label);

-- Exercise every direct UPDATE grant.
select results_eq(
  format('with changed as (update public.%I set %s where id = %L returning 1) select count(*) from changed', table_name, set_clause, own_id),
  array[1::bigint],
  'user A updates own ' || label
)
from (
  values
    ('provider_accounts', 'provider account', 'a2000000-0000-4000-8000-000000000001', $$display_name = 'Provider A updated'$$),
    ('obs_endpoints', 'OBS endpoint', 'a3000000-0000-4000-8000-000000000001', $$label = 'OBS A updated'$$),
    ('control_profiles', 'control profile', 'a4000000-0000-4000-8000-000000000001', $$name = 'Profile A updated'$$),
    ('tool_grants', 'tool grant', 'a5000000-0000-4000-8000-000000000001', $$confirmation_mode = 'session'$$),
    ('event_subscriptions', 'event subscription', 'a6000000-0000-4000-8000-000000000001', $$status = 'enabled'$$),
    ('session_records', 'session record', 'a7000000-0000-4000-8000-000000000001', $$close_reason = 'complete'$$)
) as updates(table_name, label, own_id, set_clause);

select results_eq(
  format('with changed as (update public.%I set %s where id = %L returning 1) select count(*) from changed', table_name, set_clause, foreign_id),
  array[0::bigint],
  'user A cannot update user B ' || label
)
from (
  values
    ('provider_accounts', 'provider account', 'b2000000-0000-4000-8000-000000000002', $$display_name = 'forbidden'$$),
    ('obs_endpoints', 'OBS endpoint', 'b3000000-0000-4000-8000-000000000002', $$label = 'forbidden'$$),
    ('control_profiles', 'control profile', 'b4000000-0000-4000-8000-000000000002', $$name = 'forbidden'$$),
    ('tool_grants', 'tool grant', 'b5000000-0000-4000-8000-000000000002', $$confirmation_mode = 'session'$$),
    ('event_subscriptions', 'event subscription', 'b6000000-0000-4000-8000-000000000002', $$status = 'enabled'$$),
    ('session_records', 'session record', 'b7000000-0000-4000-8000-000000000002', $$close_reason = 'forbidden'$$)
) as updates(table_name, label, foreign_id, set_clause);

-- Exercise every direct DELETE grant, child rows first to preserve fixture FKs.
select results_eq(
  format('with removed as (delete from public.%I where id = %L returning 1) select count(*) from removed', table_name, own_id),
  array[1::bigint],
  'user A deletes own ' || label
)
from (
  values
    ('feedback_records', 'feedback record', 'aa000000-0000-4000-8000-000000000001'),
    ('activity_events', 'activity event', 'a9000000-0000-4000-8000-000000000001'),
    ('event_subscriptions', 'event subscription', 'a6000000-0000-4000-8000-000000000001'),
    ('tool_grants', 'tool grant', 'a5000000-0000-4000-8000-000000000001'),
    ('obs_endpoints', 'OBS endpoint', 'a3000000-0000-4000-8000-000000000001'),
    ('control_profiles', 'control profile', 'a4000000-0000-4000-8000-000000000001'),
    ('provider_accounts', 'provider account', 'a2000000-0000-4000-8000-000000000001')
) as deletes(table_name, label, own_id)
order by array_position(array['feedback_records', 'activity_events', 'event_subscriptions', 'tool_grants', 'obs_endpoints', 'control_profiles', 'provider_accounts'], table_name);

select results_eq(
  format('with removed as (delete from public.%I where id = %L returning 1) select count(*) from removed', table_name, foreign_id),
  array[0::bigint],
  'user A cannot delete user B ' || label
)
from (
  values
    ('feedback_records', 'feedback record', 'ba000000-0000-4000-8000-000000000002'),
    ('activity_events', 'activity event', 'b9000000-0000-4000-8000-000000000002'),
    ('event_subscriptions', 'event subscription', 'b6000000-0000-4000-8000-000000000002'),
    ('tool_grants', 'tool grant', 'b5000000-0000-4000-8000-000000000002'),
    ('obs_endpoints', 'OBS endpoint', 'b3000000-0000-4000-8000-000000000002'),
    ('control_profiles', 'control profile', 'b4000000-0000-4000-8000-000000000002'),
    ('provider_accounts', 'provider account', 'b2000000-0000-4000-8000-000000000002')
) as deletes(table_name, label, foreign_id);

select results_eq(
  format('select count(*) from public.%I where user_id = %L', table_name, '20000000-0000-4000-8000-000000000002'),
  array[0::bigint],
  'user A cannot select user B ' || label
)
from (
  values
    ('profiles', 'profile'), ('devices', 'device'),
    ('provider_accounts', 'provider account'), ('obs_endpoints', 'OBS endpoint'),
    ('control_profiles', 'control profile'), ('tool_grants', 'tool grant'),
    ('event_subscriptions', 'event subscription'), ('session_records', 'session record'),
    ('command_audit', 'command audit'), ('activity_events', 'activity event'),
    ('feedback_records', 'feedback record'), ('account_deletion_requests', 'deletion request')
) as application_tables(table_name, label);


reset role;

select is(
  (
    select count(*)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'private')
      and c.relname in (
        'profiles', 'devices', 'provider_accounts', 'oauth_token_secrets',
        'obs_endpoints', 'control_profiles', 'tool_grants', 'event_subscriptions',
        'session_records', 'command_audit', 'activity_events', 'feedback_records',
        'client_mutations', 'sync_outbox', 'account_deletion_requests'
      )
      and c.relrowsecurity
      and c.relforcerowsecurity
  ),
  15::bigint,
  'all application tables enable and force RLS'
);
select ok(
  not has_table_privilege('authenticated', 'private.oauth_token_secrets', 'select')
    and not has_table_privilege('authenticated', 'private.oauth_token_secrets', 'insert')
    and not has_table_privilege('authenticated', 'private.oauth_token_secrets', 'update')
    and not has_table_privilege('authenticated', 'private.oauth_token_secrets', 'delete'),
  'authenticated has no CRUD access to token secrets'
);
select ok(
  not has_table_privilege('authenticated', 'private.client_mutations', 'select')
    and not has_table_privilege('authenticated', 'private.client_mutations', 'insert')
    and not has_table_privilege('authenticated', 'private.client_mutations', 'update')
    and not has_table_privilege('authenticated', 'private.client_mutations', 'delete'),
  'authenticated has no CRUD access to idempotency receipts'
);
select ok(
  not has_table_privilege('authenticated', 'private.sync_outbox', 'select')
    and not has_table_privilege('authenticated', 'private.sync_outbox', 'insert')
    and not has_table_privilege('authenticated', 'private.sync_outbox', 'update')
    and not has_table_privilege('authenticated', 'private.sync_outbox', 'delete'),
  'authenticated has no CRUD access to server integration work'
);
select ok(
  not has_table_privilege('anon', 'public.profiles', 'select'),
  'anonymous has no profile access'
);

select * from finish();
rollback;
