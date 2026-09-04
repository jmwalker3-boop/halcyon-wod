// Direct Postgres connection for backend-only work that must bypass RLS by
// design -- running the doctrine validator and writing validation_results,
// same category of job as the Stripe webhook handler and the generation
// engine (see 20260903150000_row_level_security.sql's header: service_role
// bypasses RLS entirely, and this is that access path at the SQL level).
// Never import this into a client component or anything reachable from a
// user-scoped request without an explicit authorization check first --
// there's no RLS backstop here.
//
// DATABASE_URL is Supabase's direct Postgres connection string (Project
// Settings -> Database -> Connection string -> URI), not the anon/service
// REST endpoint.

import pg from 'pg';

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}
