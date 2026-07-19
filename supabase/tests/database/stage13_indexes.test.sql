begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select has_index('public', 'devices', 'devices_user_updated_idx', 'device refresh is indexed');
select has_index('public', 'provider_accounts', 'provider_accounts_user_updated_idx', 'provider refresh is indexed');
select has_index('public', 'control_profiles', 'control_profiles_user_updated_idx', 'profile refresh is indexed');
select has_index('public', 'tool_grants', 'tool_grants_user_updated_idx', 'grant refresh is indexed');
select has_index('public', 'session_records', 'session_records_expiry_idx', 'session retention is indexed');
select has_index('public', 'command_audit', 'command_audit_user_occurred_idx', 'audit timeline is indexed');
select has_index('public', 'activity_events', 'activity_events_user_cursor_idx', 'activity cursor is indexed');
select has_index('public', 'activity_events', 'activity_events_expiry_idx', 'activity retention is indexed');
select has_index('public', 'feedback_records', 'feedback_records_expiry_idx', 'feedback retention is indexed');
select has_index('private', 'sync_outbox', 'sync_outbox_pending_idx', 'outbox delivery is indexed');
select has_index('public', 'account_deletion_requests', 'deletion_due_idx', 'deletion due work is indexed');
select has_index('public', 'account_deletion_requests', 'deletion_processing_lease_idx', 'deletion leases are indexed');

select * from finish();
rollback;
