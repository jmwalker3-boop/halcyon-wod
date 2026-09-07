// POST /api/account/delete
//
// Self-service account deletion (John's request, 2026-09-07: athletes
// should be able to delete their own account from /account, not just
// admin-on-someone-else). Deletes the caller's own auth.users row via the
// RLS-bypassing pool -- everything referencing profiles(id) cascades
// except programs.owner_id, which is "on delete restrict" (an athlete
// account is never a program owner in practice, but a future coach/admin
// self-deleting while owning a program will get a clear FK error instead
// of silently orphaning the program).
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPool } from '@/lib/db/pool';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const pool = getPool();
  try {
    await pool.query('delete from auth.users where id = $1', [user.id]);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

