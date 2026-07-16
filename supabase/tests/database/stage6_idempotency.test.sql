begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '30000000-0000-4000-8000-000000000003',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'stage6-idempotency@example.test', '',
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-4000-8000-000000000003',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$select * from public.register_device(
    'cccccccc-0000-4000-8000-000000000003',
    'Primary device', 'win32', '0.1.0'
  )$$,
  'device registration succeeds'
);
select lives_ok(
  $$select * from public.register_device(
    'cccccccc-0000-4000-8000-000000000003',
    'Primary device', 'win32', '0.1.0'
  )$$,
  'device registration is an upsert'
);
select is(
  (select revision from public.update_creator_profile(
    'dddddddd-0000-4000-8000-000000000004',
    1, 'Updated creator', 'en-US', 'UTC'
  )),
  2::bigint,
  'first profile mutation advances revision'
);
select is(
  (select revision from public.update_creator_profile(
    'dddddddd-0000-4000-8000-000000000004',
    1, 'Updated creator', 'en-US', 'UTC'
  )),
  2::bigint,
  'duplicate idempotency key returns original result'
);
select is(
  (select count(*) from public.update_creator_profile(
    'eeeeeeee-0000-4000-8000-000000000005',
    1, 'Conflicting creator', 'en-US', 'UTC'
  )),
  0::bigint,
  'stale expected revision returns deterministic conflict'
);
select throws_ok(
  $$select * from public.update_creator_profile(
    'dddddddd-0000-4000-8000-000000000004',
    2, 'Different input', 'en-US', 'UTC'
  )$$,
  '23514',
  null,
  'idempotency key reuse with changed input is rejected'
);

select * from finish();
rollback;

