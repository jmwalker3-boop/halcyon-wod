// POST /api/auth/reset-password  { token: string, password: string }
//
// Redeems a token minted by /api/auth/request-password-reset. This is a
// plain bearer token (its hash checked against password_reset_tokens), not
// a Supabase auth session, since the request route never touches
// Supabase's own auth flow -- so this can't just be
// supabase.auth.updateUser() (that only ever affects the CALLER's own
// session). Same direct-SQL crypt()/gen_salt('bf') write as
// app/api/admin/set-password/route.ts.
import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getPool } from '@/lib/db/pool';

export async function POST(request: Request) {
  const { token, password } = await request.json();
  if (typeof token !== 'string' || typeof password !== 'string' || password.length < 6) {
    return NextResponse.json({ error: 'A reset token and a password of at least 6 characters are required.' }, { status: 400 });
  }

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const pool = getPool();

  const { rows } = await pool.query(
    `select id, email from public.password_reset_tokens
     where token_hash = $1 and used_at is null and expires_at > now()`,
    [tokenHash],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'This reset link is invalid or has expired. Request a new one.' }, { status: 400 });
  }

  const { id, email } = rows[0];
  await pool.query(
    `update auth.users set encrypted_password = crypt($1, gen_salt('bf')), updated_at = now() where email = $2`,
    [password, email],
  );
  await pool.query(`update public.password_reset_tokens set used_at = now() where id = $1`, [id]);

  return NextResponse.json({ ok: true });
}
