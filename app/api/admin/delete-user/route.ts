// POST /api/admin/delete-user  { profileId: string }
//
// Deletes a user entirely -- John's request (2026-09-07): admin should be
// able to delete an athlete's account, not just unenroll them. Deletes
// auth.users directly via the RLS-bypassing pool (same pattern as
// set-password); every table that references profiles(id) does so with
// "on delete cascade" except programs.owner_id ("on delete restrict" --
// deleting a program's owner is deliberately blocked, surfaces as a clear
// Postgres FK error rather than silently orphaning a program).
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

  const { profileId } = await request.json();
  if (typeof profileId !== 'string' || !profileId) {
    return NextResponse.json({ error: 'profileId is required.' }, { status: 400 });
  }
  if (profileId === user.id) {
    return NextResponse.json({ error: "Can't delete your own account from here." }, { status: 400 });
  }

  const pool = getPool();
  try {
    const result = await pool.query('delete from auth.users where id = $1 returning id', [profileId]);
    if (result.rowCount === 0) {
      return NextResponse.json({ error: 'No account found.' }, { status: 404 });
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

