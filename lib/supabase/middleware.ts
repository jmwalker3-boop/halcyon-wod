// Refreshes the Supabase auth session on every request that isn't a static
// asset (wired up in middleware.ts at the app root). This is the standard
// @supabase/ssr pattern -- without it, a session cookie can go stale
// between Server Component renders since those can't write cookies back to
// the browser themselves (see server.ts's setAll comment).

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        },
      },
    },
  );

  // Touches the session so Supabase can refresh an expiring token -- the
  // returned user isn't used here, just the refresh side effect.
  await supabase.auth.getUser();

  return response;
}
