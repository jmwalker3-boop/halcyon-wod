// Server-side Supabase client -- for Server Components, Server Actions, and
// Route Handlers. Reads/writes the auth cookies via Next's cookies() API so
// the user's session travels with the request. Still uses the anon key and
// is still subject to RLS -- this is "the same athlete, running server-side,"
// not a backend/service-role client. For jobs that must bypass RLS by
// design (the generation engine, the Stripe webhook, running the validator
// against `validation_results`), use the direct Postgres connection in
// lib/db/pool.ts instead, exactly like the migrations README describes for
// service_role-only tables.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from '../db/types';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component -- middleware.ts already
            // refreshes the session on every request, so a failed set here
            // (no response object available to attach cookies to) is safe
            // to ignore rather than throw.
          }
        },
      },
    },
  );
}
