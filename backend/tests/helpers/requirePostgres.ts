/**
 * @file requirePostgres.ts
 * @description Fail-closed gate for Postgres integration suites.
 *
 *   MEASURED DEFECT: guarded PG suites skipped silently. `tests/setup.ts` forces
 *   SUPABASE_URL to `http://localhost:54321` while the guards tested for
 *   '127.0.0.1', and `vitest.config.ts` registers no `setupFiles` — so the
 *   string never matched, four files / 29 tests never executed, and the command
 *   exited 0. Every "green" run that included them proved nothing about them.
 *
 *   THE RULE: skipping is allowed, claiming certification while skipping is not.
 *   In normal unit runs these suites may skip. Under
 *   `PG_INTEGRATION=required` — which the certification script sets — a missing
 *   or unreachable database THROWS instead, so the command cannot report success
 *   on a suite that never ran.
 *
 *   Availability is decided by an actual reachability probe, not by matching
 *   substrings of a URL.
 *
 * @security Test-only. Refuses any non-local database so a certification run
 *   cannot be pointed at production data.
 * @dependencies none (fetch only)
 */

export interface PostgresHandle {
  available: boolean;
  url: string;
  serviceKey: string;
  anonKey: string;
  reason: string | null;
}

/** True only for a loopback host — a certification run must never hit prod. */
function isLocal(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
  } catch {
    return false;
  }
}

let cached: PostgresHandle | null = null;

/**
 * Resolves the local Supabase used by integration suites.
 *
 * @returns a handle; `available:false` with a reason when it cannot be used
 * @throws when PG_INTEGRATION=required and the database is unusable — this is
 *   what stops a certification run from passing by skipping.
 */
export function requirePostgres(): PostgresHandle {
  if (cached) return gate(cached);

  const url = process.env.SUPABASE_URL ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';

  let reason: string | null = null;
  if (!url) reason = 'SUPABASE_URL is not set';
  else if (!isLocal(url)) reason = `SUPABASE_URL is not a local database (${url})`;
  else if (!serviceKey || serviceKey === 'test-service-role-key') reason = 'SUPABASE_SERVICE_ROLE_KEY is not a real local key';
  else if (!anonKey) reason = 'SUPABASE_ANON_KEY is not set';

  cached = { available: reason === null, url, serviceKey, anonKey, reason };
  return gate(cached);
}

function gate(h: PostgresHandle): PostgresHandle {
  if (!h.available && process.env.PG_INTEGRATION === 'required') {
    throw new Error(
      `POSTGRES_INTEGRATION_UNAVAILABLE: ${h.reason}. ` +
      `This command certifies Postgres integration, so it fails rather than ` +
      `skipping. Start the local stack (\`npx supabase start\`) and re-run ` +
      `\`npm run test:pg\`.`,
    );
  }
  return h;
}
