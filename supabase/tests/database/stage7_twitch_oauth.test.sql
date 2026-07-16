begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

select has_table('private', 'oauth_flows', 'OAuth flow custody table is private');
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'private.oauth_flows'::regclass),
  'OAuth flows enable and force RLS'
);
select has_function('public', 'stage7_begin_twitch_oauth', array['uuid', 'text', 'text'], 'begin RPC exists');
select has_function('public', 'stage7_claim_twitch_refresh', array['uuid', 'uuid'], 'refresh lease RPC exists');
select ok(
  not has_function_privilege('authenticated', 'public.stage7_get_twitch_token(uuid)', 'execute'),
  'authenticated cannot retrieve token ciphertext'
);
select ok(
  not has_function_privilege('anon', 'public.stage7_begin_twitch_oauth(uuid,text,text)', 'execute'),
  'anonymous callers cannot create OAuth flows'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '70000000-0000-4000-8000-000000000007',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'stage7@example.test', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role service_role;
create temporary table stage7_fixture(flow_id uuid, token_revision bigint) on commit drop;
insert into stage7_fixture(flow_id)
select flow_id from public.stage7_begin_twitch_oauth(
  '70000000-0000-4000-8000-000000000007',
  repeat('a', 64),
  repeat('B', 43)
);

select is(
  (select count(*) from public.stage7_claim_twitch_oauth_callback(repeat('a', 64))),
  1::bigint,
  'valid state is claimed exactly once'
);
select is(
  (select count(*) from public.stage7_claim_twitch_oauth_callback(repeat('a', 64))),
  0::bigint,
  'OAuth state replay is rejected'
);
select lives_ok(
  format(
    $$select public.stage7_complete_twitch_oauth(
      %L, '70000000-0000-4000-8000-000000000007', '1234567', 'Creator',
      array[]::text[], decode(repeat('ab', 32), 'hex'), 1, now() + interval '1 hour'
    )$$,
    (select flow_id from stage7_fixture)
  ),
  'server completes an exchanged OAuth flow'
);
select throws_ok(
  format(
    $$select * from public.stage7_finalize_twitch_oauth(
      '70000000-0000-4000-8000-000000000007', %L, repeat('C', 43)
    )$$,
    (select flow_id from stage7_fixture)
  ),
  '40001', null, 'incorrect desktop verifier proof is rejected'
);
select lives_ok(
  format(
    $$select * from public.stage7_finalize_twitch_oauth(
      '70000000-0000-4000-8000-000000000007', %L, repeat('B', 43)
    )$$,
    (select flow_id from stage7_fixture)
  ),
  'correct verifier proof consumes the completed flow'
);
select throws_ok(
  format(
    $$select * from public.stage7_finalize_twitch_oauth(
      '70000000-0000-4000-8000-000000000007', %L, repeat('B', 43)
    )$$,
    (select flow_id from stage7_fixture)
  ),
  '40001', null, 'OAuth finalization replay is rejected'
);

update stage7_fixture set token_revision = claim.token_revision
from public.stage7_claim_twitch_refresh(
  '70000000-0000-4000-8000-000000000007',
  '71111111-0000-4000-8000-000000000007'
) claim;
select isnt((select token_revision from stage7_fixture), null::bigint, 'first refresh obtains a lease');
select is(
  (select count(*) from public.stage7_claim_twitch_refresh(
    '70000000-0000-4000-8000-000000000007',
    '72222222-0000-4000-8000-000000000007'
  )),
  0::bigint,
  'concurrent refresh cannot obtain the active lease'
);
select is(
  public.stage7_complete_twitch_refresh(
    '70000000-0000-4000-8000-000000000007',
    '71111111-0000-4000-8000-000000000007',
    (select token_revision from stage7_fixture),
    decode(repeat('cd', 32), 'hex'), 1, now() + interval '2 hours', array[]::text[]
  ),
  true,
  'lease owner commits one refresh rotation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-4000-8000-000000000007', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select * from public.stage7_get_twitch_status('70000000-0000-4000-8000-000000000007')$$,
  '42501', null, 'authenticated desktop cannot call server-only token status RPC directly'
);

select * from finish();
rollback;
