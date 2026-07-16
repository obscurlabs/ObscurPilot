begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '40000000-0000-4000-8000-000000000004',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'stage6-deletion@example.test', '',
  now(), '{provider:email,providers:[email]}', '{}', now(), now()
);

insert into public.account_deletion_requests(user_id, execute_after)
values (
  '40000000-0000-4000-8000-000000000004',
  now() - interval '1 minute'
);

set local role service_role;

select is(
  (select count(*) from public.claim_account_deletions(25, 900)),
  1::bigint,
  'a due deletion is claimed once'
);
select is(
  (
    select status from public.account_deletion_requests
    where user_id = '40000000-0000-4000-8000-000000000004'
  ),
  'processing',
  'claim moves the request to processing'
);
select is(
  (
    select attempts from public.account_deletion_requests
    where user_id = '40000000-0000-4000-8000-000000000004'
  ),
  1,
  'claim increments the attempt count'
);
select is(
  (
    select public.release_account_deletion(
      id,
      'ADMIN_DELETE_FAILED',
      60
    )
    from public.account_deletion_requests
    where user_id = '40000000-0000-4000-8000-000000000004'
  ),
  true,
  'a failed administration call releases the lease'
);
select is(
  (
    select status from public.account_deletion_requests
    where user_id = '40000000-0000-4000-8000-000000000004'
  ),
  'pending',
  'released requests return to pending'
);

reset role;
update public.account_deletion_requests
set status = 'processing',
    processing_started_at = now() - interval '2 minutes',
    next_attempt_at = now() - interval '1 minute'
where user_id = '40000000-0000-4000-8000-000000000004';
set local role service_role;

select is(
  (select count(*) from public.claim_account_deletions(25, 60)),
  1::bigint,
  'an expired processing lease is recovered and reclaimed'
);
select is(
  (
    select attempts from public.account_deletion_requests
    where user_id = '40000000-0000-4000-8000-000000000004'
  ),
  2,
  'lease recovery advances the attempt count once'
);

select * from finish();
rollback;
