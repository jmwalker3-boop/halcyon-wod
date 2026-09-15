// POST /api/auth/request-password-reset  { email: string }
//
// Deliberately doesn't use supabase.auth.resetPasswordForEmail() -- that
// sends Supabase's own built-in email, which isn't branded and would need
// custom SMTP configured in the Supabase dashboard to route through Resend.
// Instead this generates its own one-time token (same
// crypt()/gen_salt('bf')-via-direct-SQL family of approach as
// app/api/admin/set-password/route.ts) and drops a row in email_outbox --
// the Postgres trigger on that table is what actually calls the
// send-account-email Edge Function. That keeps the Resend API key and the
// webhook secret entirely on the Supabase side; this route, and Vercel,
// never need to know either one.
//
// Always returns ok regardless of whether the email exists, so this can't
// be used to enumerate accounts.
import { NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { getPool } from '@/lib/db/pool';

export async function POST(request: Request) {
  const { email } = await request.json();
  if (typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 });
  }
  const trimmedEmail = email.trim();

  const pool = getPool();
  const { rows } = await pool.query(
    `select u.id, coalesce(p.display_name, 'there') as display_name
     from auth.users u
     left join public.profiles p on p.id = u.id
     where u.email = $1`,
    [trimmedEmail],
  );

  if (rows.length > 0) {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const origin = new URL(request.url).origin;
    const resetUrl = `${origin}/reset-password?token=${rawToken}`;

    await pool.query(
      `insert into public.password_reset_tokens (email, token_hash, expires_at)
       values ($1, $2, now() + interval '1 hour')`,
      [trimmedEmail, tokenHash],
    );
    await pool.query(
      `insert into public.email_outbox (template, to_email, data)
       values ('password_reset', $1, jsonb_build_object('resetUrl', $2, 'displayName', $3))`,
      [trimmedEmail, resetUrl, rows[0].display_name],
    );
  }

  return NextResponse.json({ ok: true });
}
