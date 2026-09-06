// POST /api/admin/set-password  { email: string, password: string }
//
// Lets an admin set (or reset) the password on ANY account by email --
// John's request (2026-09-07): with several accounts in active use for
// testing, and no SMTP set up yet, there was no way to get a fresh
// password onto an enrolled-but-never-logged-in-with-a-password account
// without that account's own inbox. Every other password action in this
// app (Settings' "set a password" card) only ever touches the CALLER's own
// session via supabase.auth.updateUser() -- that can't set someone else's
// password, by design, so this route exists specifically for the
// admin-acting-on-another-account case.
//
// Deliberately does this via a direct SQL UPDATE on auth.users through the
// existing RLS-bypassing pool (lib/db/pool.ts), matching GoTrue's own
// bcrypt hashing via pgcrypto's crypt()/gen_salt('bf') -- rather than
// adding a SUPABASE_SERVICE_ROLE_KEY env var and calling the
// supabase-js auth.admin.* API, which would be the "more official" path
// but needs a new secret provisioned in Vercel that doesn't exist yet.
// This is the same "well-known Supabase direct-SQL password reset"
// approach documented all over Supabase's own community answers -- it
// works because GoTrue verifies passwords with bcrypt regardless of
// whether the hash was written by GoTrue itself or by this route.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPool } from '@/lib/db/pool';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
  }

  const { email, password } = await request.json();
  if (typeof email !== 'string' || typeof password !== 'string' || password.length < 6) {
    return NextResponse.json({ error: 'Email and a password of at least 6 characters are required.' }, { status: 400 });
  }

  const pool = getPool();
  const result = await pool.query(
    `update auth.users
     set encrypted_password = crypt($1, gen_salt('bf')), updated_at = now()
     where email = $2
     returning id`,
    [password, email.trim()],
  );

  if (result.rowCount === 0) {
    return NextResponse.json(
      { error: 'No account found for that email -- they need to sign in at least once first.' },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
