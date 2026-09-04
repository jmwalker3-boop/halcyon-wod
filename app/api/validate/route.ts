// POST /api/validate  { generationDraftId: string }
//
// Runs the doctrine validator (@blackboxmethod/validator) against one
// generation_draft and persists the result. This is the one place in the
// skeleton that needs the direct-Postgres, RLS-bypassing pool (lib/db/pool.ts)
// rather than the RLS-scoped Supabase clients -- fetchContext reads across
// tables (calendar_slots, training_blocks, personal_records, movements,
// segment_ties) that no single role should need direct grants on just to
// generate a workout, and validation_results is itself write-restricted to
// admin/service_role by RLS (migrations README, section 6).
//
// Authorization is checked separately, with the anon-key server client, so
// RLS still decides who's allowed to *ask* for a validation run even though
// the run itself bypasses RLS to read what it needs -- only a coach or
// admin can trigger this, matching who's allowed to own/manage programs at
// all (the generation engine itself would call runValidator directly,
// in-process, without going through this HTTP boundary -- this route is
// for a coach-facing "re-validate this draft" action in the UI).

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getPool } from '@/lib/db/pool';
import { runValidator, DEFAULT_RULE_CONFIG } from '@blackboxmethod/validator';
import { fetchContext } from '@blackboxmethod/validator/context';
import { persistValidationResult } from '@blackboxmethod/validator/persist';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (!profile || (profile.role !== 'coach' && profile.role !== 'admin')) {
    return NextResponse.json({ error: 'forbidden -- coach or admin only' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const generationDraftId = body?.generationDraftId;
  if (typeof generationDraftId !== 'string') {
    return NextResponse.json({ error: 'generationDraftId is required' }, { status: 400 });
  }

  const pool = getPool();
  const draftRow = await pool.query(
    `select gr.calendar_slot_id, gd.draft_sequence
       from generation_drafts gd
       join generation_requests gr on gr.id = gd.generation_request_id
      where gd.id = $1`,
    [generationDraftId],
  );
  if (draftRow.rows.length === 0) {
    return NextResponse.json({ error: 'generation_draft not found' }, { status: 404 });
  }

  const { calendar_slot_id, draft_sequence } = draftRow.rows[0];
  const context = await fetchContext(pool, calendar_slot_id);
  const outcome = runValidator(draft_sequence, context, DEFAULT_RULE_CONFIG);
  const validationResultId = await persistValidationResult(pool, generationDraftId, outcome);

  return NextResponse.json({ validationResultId, ...outcome });
}
