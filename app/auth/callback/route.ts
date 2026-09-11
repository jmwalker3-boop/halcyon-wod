import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Standard @supabase/ssr magic-link callback: exchanges the emailed code
// for a session, cookie-side, then sends the athlete to /account to fill
// out their info and set a password (2026-09-11, John's request).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/account`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
