import { createClient } from '@supabase/supabase-js';

const headers = { 'Content-Type': 'application/json' };

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response('{"error":"method_not_allowed"}', { status: 405, headers });
  }

  const expectedJobSecret = Deno.env.get('OBSCURPILOT_DELETION_JOB_SECRET');
  const suppliedJobSecret = request.headers.get('x-obscurpilot-job-secret');
  if (
    expectedJobSecret === undefined ||
    expectedJobSecret.length < 32 ||
    suppliedJobSecret === null ||
    !(await timingSafeEqual(expectedJobSecret, suppliedJobSecret))
  ) {
    return new Response('{"error":"unauthorized"}', { status: 401, headers });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = resolveServerKey();
  if (url === undefined || serviceKey === undefined) {
    return new Response('{"error":"server_misconfigured"}', { status: 500, headers });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  let purged = 0;
  for (let batch = 0; batch < 10; batch += 1) {
    const retention = await admin.rpc('run_retention_maintenance', { p_batch_size: 500 });
    if (retention.error !== null) {
      return new Response('{"error":"retention_failed"}', { status: 503, headers });
    }
    purged += retention.data;
    if (retention.data < 1_500) break;
  }
  const due = await admin.rpc('claim_account_deletions', {
    p_limit: 25,
    p_lease_seconds: 900,
  });
  if (due.error !== null) {
    return new Response('{"error":"query_failed"}', { status: 503, headers });
  }

  let deleted = 0;
  let failed = 0;
  for (const candidate of due.data) {
    const result = await admin.auth.admin.deleteUser(candidate.user_id, false);
    if (result.error === null) {
      deleted += 1;
    } else {
      failed += 1;
      const retryDelaySeconds = Math.min(86_400, 60 * 2 ** Math.min(candidate.attempts - 1, 10));
      await admin.rpc('release_account_deletion', {
        p_request_id: candidate.request_id,
        p_error_code: 'ADMIN_DELETE_FAILED',
        p_retry_delay_seconds: retryDelaySeconds,
      });
    }
  }

  return new Response(JSON.stringify({ processed: deleted + failed, deleted, failed, purged }), {
    status: failed === 0 ? 200 : 207,
    headers,
  });
});

async function timingSafeEqual(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
}

function resolveServerKey(): string | undefined {
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (legacy !== undefined && legacy.length > 0) return legacy;
  const encoded = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (encoded === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(encoded);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    return Object.values(parsed).find(
      (value): value is string => typeof value === 'string' && value.startsWith('sb_secret_'),
    );
  } catch {
    return undefined;
  }
}
