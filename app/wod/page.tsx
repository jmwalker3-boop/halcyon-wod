import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ScoreForm from '@/components/ScoreForm';
import WodTabs from '@/components/WodTabs';
import TabBar from '@/components/TabBar';
import TopBar from '@/components/TopBar';

// Today's WOD, split out of /dashboard (John's request, 2026-09-07):
// "'Today's wod' is a great landing, but the wod and 'as written' and 'my
// rx' stuff should all be under the 'wod (skull)' page." /dashboard keeps
// the hero card as a preview; everything interactive (the Rx/Scaled/Minimal
// toggle, scoring, gym average, coach's note) lives here instead.
//
// Rx / Scaled / Minimal (John's call, 2026-09-29) replaces the old As
// Written / My Rx toggle: fixed, pre-authored variants per workout instead
// of live per-athlete equipment/skill resolution.
//   - Rx: the workout exactly as written (raw_text).
//   - Scaled: the identified scale/substitute already on file per movement
//     (movement_scales, movement_equipment_substitutes) -- reference data,
//     not personalized to any one athlete.
//   - Minimal: a DB/KB-and-equipment-free variant of the same workout,
//     authored per-workout and linked via workouts.minimal_workout_id.
//     Reviewed/approved alongside the parent through the same Sunday Coach
//     Deck pass as everything else -- it doesn't have its own approval gate.
//
// Date-paged via ?date= (John's request, same day: "Landing page should
// show 'Today's wod' card, but no other wods. The week's wods can be
// clicked-through with a 'Tomorrow's Wod' button or an arrow... there can
// be a 'Tuesday's WOD', 'Wednesday's WOD', etc.") -- clamped to the same
// rolling 7-day window (today..today+6) the dashboard used to render as a
// single list, so paging forward can't wander into days that were never
// generated.
function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function WodPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const today = new Date().toISOString().slice(0, 10);
  const maxDate = addDays(today, 6);
  const { date: dateParam } = await searchParams;
  const targetDate =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam >= today && dateParam <= maxDate ? dateParam : today;

  const dayTitle =
    targetDate === today ? "Today's WOD" : `${new Date(`${targetDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}'s WOD`;
  const dayLabel = dayTitle.toUpperCase();
  const prevDate = targetDate > today ? addDays(targetDate, -1) : null;
  const nextDate = targetDate < maxDate ? addDays(targetDate, 1) : null;
  const prevLabel = prevDate === today ? "Today's WOD" : prevDate ? `${new Date(`${prevDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}'s WOD` : null;
  const nextLabel = nextDate ? `${new Date(`${nextDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}'s WOD` : null;

  const { data: enrollments } = await supabase
    .from('program_enrollments')
    .select(
      `
      program_id,
      programs (
        name,
        program_cycles (
          start_date, length_days,
          calendar_slots (
            id, date, day_type, target_modalities, status, override_reason,
            workouts (
              id, title, raw_text, is_benchmark, coach_notes, scaling_notes, result_type_override, result_type_override_2, allow_multiple_time_scores,
              minimal_workout_id,
              minimal:minimal_workout_id ( id, title, raw_text ),
              workout_movements ( movements ( id, canonical_name ) )
            )
          )
        )
      )
    `,
    )
    .eq('profile_id', user.id)
    .eq('active', true);

  const [{ data: allMovementRows }, { data: movementScaleRows }, { data: equipmentSubstituteRows }] = await Promise.all([
    supabase.from('movements').select('id, canonical_name, equipment').order('canonical_name', { ascending: true }),
    supabase.from('movement_scales').select('movement_id, tier, scale_movement_id'),
    supabase.from('movement_equipment_substitutes').select('movement_id, substitute_id'),
  ]);

  // Reference data, not personalized to any one athlete: movement_id ->
  // {intermediate?, beginner?, equipment?} name, resolved once here so the
  // Scaled tab is a flat lookup per movement in the workout.
  const movementNameById = new Map((allMovementRows ?? []).map((m: any) => [m.id, m.canonical_name as string]));
  const scaleByMovementId = new Map<string, { intermediate?: string; beginner?: string }>();
  for (const row of (movementScaleRows ?? []) as any[]) {
    const name = movementNameById.get(row.scale_movement_id);
    if (!name) continue;
    const entry = scaleByMovementId.get(row.movement_id) ?? {};
    entry[row.tier as 'intermediate' | 'beginner'] = name;
    scaleByMovementId.set(row.movement_id, entry);
  }
  const equipmentSubByMovementId = new Map<string, string>();
  for (const row of (equipmentSubstituteRows ?? []) as any[]) {
    const name = movementNameById.get(row.substitute_id);
    if (name) equipmentSubByMovementId.set(row.movement_id, name);
  }

  function formatSeconds(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // Find the target day's slot -- first enrollment/cycle whose
  // calendar_slots contains it, same "one program" assumption the rest of
  // the app makes. undefined if not enrolled, or enrolled but no slot
  // that day. status === 'approved' gate (2026-09-29), same as /dashboard
  // and /board -- an unapproved day reads the same as "nothing scheduled."
  let daySlot: any = null;
  for (const enrollment of (enrollments ?? []) as any[]) {
    for (const cycle of enrollment.programs?.program_cycles ?? []) {
      const slot = (cycle.calendar_slots ?? []).find((s: any) => s.date === targetDate && s.status === 'approved');
      if (slot) {
        daySlot = { slot, cycle };
        break;
      }
    }
    if (daySlot) break;
  }

  const dayNav = (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 12 }}>
      {prevDate ? (
        <Link href={`/wod?date=${prevDate}`} className="hw-link-back">← {prevLabel}</Link>
      ) : (
        <span />
      )}
      {nextDate && <Link href={`/wod?date=${nextDate}`} className="hw-link-back">{nextLabel} →</Link>}
    </div>
  );

  if (!daySlot || !daySlot.slot.workouts) {
    // A Recovery day intentionally has no workout row -- that's not a gap,
    // it's the program working as designed, so it reads as "Rest Day" (plus
    // whatever note the coach left in Coach Deck, e.g. "get out and play")
    // rather than "Nothing scheduled," which read like a day was forgotten
    // (John's report, 2026-09-29). A slot that's missing entirely (not
    // enrolled, out of range, not yet approved) or a Training day that just
    // hasn't been generated yet still gets the original message -- those
    // really are gaps.
    const isRestDay = daySlot?.slot?.day_type === 'Recovery';
    return (
      <main className="hw-shell">
        <TopBar />
        <div className="hw-wrap" style={{ paddingTop: 90, paddingBottom: 100 }}>
          <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
          <div className="hw-h1" style={{ fontSize: 26, marginTop: 12 }}>{isRestDay ? 'Rest Day' : dayTitle}</div>
          {dayNav}
          <div className="hw-card" style={{ marginTop: 16 }}>
            {isRestDay ? (
              <>
                <p style={{ margin: 0 }}>No WOD today — it&apos;s a scheduled recovery day.</p>
                {daySlot?.slot.override_reason && (
                  <p className="hw-muted" style={{ marginTop: 10, marginBottom: 0 }}>{daySlot.slot.override_reason}</p>
                )}
              </>
            ) : (
              <p style={{ margin: 0 }}>Nothing scheduled {targetDate === today ? 'for today' : 'that day'}.</p>
            )}
          </div>
        </div>
        <TabBar />
      </main>
    );
  }

  const { slot } = daySlot;

  // "GYM AVERAGE" (mockup 2b) -- average of everyone's 'time' scores on
  // this specific workout instance.
  const { data: gymTimeRows } = await supabase
    .from('workout_logs')
    .select('result_value')
    .eq('workout_id', slot.workouts.id)
    .eq('result_type', 'time');
  const gymSeconds = (gymTimeRows ?? []).map((r: any) => r.result_value.seconds as number);
  const gymAverage = gymSeconds.length
    ? { seconds: gymSeconds.reduce((a, b) => a + b, 0) / gymSeconds.length, count: gymSeconds.length }
    : null;

  const workoutMovements = (slot.workouts.workout_movements ?? []).filter((wm: any) => wm.movements);

  return (
    <main className="hw-shell">
      <TopBar />
      <div className="hw-wrap" style={{ paddingTop: 90, paddingBottom: 100 }}>
        <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
        {dayNav}

        <div className="hw-card-dark" style={{ marginTop: 12, padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '12px 16px',
              borderBottom: '4px solid var(--hw-ink)',
              background: 'var(--hw-mustard)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span className="hw-label" style={{ color: 'var(--hw-ink)' }}>{dayLabel}</span>
            {slot.workouts.is_benchmark && <span className="hw-pill hw-pill-dark">Benchmark</span>}
          </div>
          <div style={{ padding: '18px 16px' }}>
            <div className="hw-h1" style={{ fontSize: 30, textShadow: '3px 3px 0 var(--hw-pink)' }}>
              {slot.workouts.title ?? dayLabel}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <WodTabs
            rx={
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  font: '700 12px/1.7 "Space Mono", monospace',
                  color: 'var(--hw-ink)',
                  margin: 0,
                }}
              >
                {slot.workouts.raw_text ?? '(no content yet)'}
              </pre>
            }
            scaled={
              workoutMovements.length === 0 ? (
                <p className="hw-muted">Nothing to scale for this one.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {workoutMovements.map((wm: any) => {
                    const scale = scaleByMovementId.get(wm.movements.id);
                    const sub = scale?.intermediate ?? scale?.beginner ?? equipmentSubByMovementId.get(wm.movements.id);
                    return (
                      <div key={wm.movements.id} className="hw-card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ display: 'flex', alignItems: 'stretch' }}>
                          <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
                            <div className="hw-h3" style={{ fontSize: 16 }}>{wm.movements.canonical_name.toUpperCase()}</div>
                            {sub ? (
                              <div className="hw-muted" style={{ font: '700 11px/1.6 "Space Mono", monospace' }}>
                                → {sub.toUpperCase()}
                              </div>
                            ) : (
                              <div className="hw-muted" style={{ font: '700 11px/1.6 "Space Mono", monospace' }}>
                                No scale on file — Rx as written.
                              </div>
                            )}
                          </div>
                          <div
                            style={{
                              width: 56,
                              flex: 'none',
                              background: 'var(--hw-ink)',
                              color: sub ? 'var(--hw-mustard)' : 'var(--hw-cyan)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              textAlign: 'center',
                              font: '700 10px/1.2 "Space Mono", monospace',
                            }}
                          >
                            {sub ? 'SCALED' : 'RX'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            }
            minimal={
              slot.workouts.minimal?.raw_text ? (
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    font: '700 12px/1.7 "Space Mono", monospace',
                    color: 'var(--hw-ink)',
                    margin: 0,
                  }}
                >
                  {slot.workouts.minimal.raw_text}
                </pre>
              ) : (
                <div className="hw-card" style={{ background: 'var(--hw-violet)', color: 'var(--hw-paper)' }}>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    No DB/KB-and-equipment-free version of this one yet — ask your coach.
                  </p>
                </div>
              )
            }
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
          <ScoreForm
            workoutId={slot.workouts.id}
            calendarSlotId={slot.id}
            movements={allMovementRows ?? []}
            lockedResultType={slot.workouts.result_type_override}
            lockedResultType2={slot.workouts.result_type_override_2}
            allowMultipleTimeScores={slot.workouts.allow_multiple_time_scores}
          />
          <Link href={`/leaderboard/${slot.workouts.id}`} className="hw-btn hw-btn-dark" style={{ fontSize: 13, padding: 12 }}>
            The board →
          </Link>
        </div>

        {gymAverage && (
          <div className="hw-card" style={{ marginTop: 12, background: 'var(--hw-orange)' }}>
            <span className="hw-label">GYM AVERAGE</span>
            <div style={{ font: '700 22px/1.3 "Space Mono", monospace', marginTop: 4 }}>
              {formatSeconds(gymAverage.seconds)}
            </div>
            <div style={{ font: '400 10px/1 "Space Mono", monospace' }}>
              {gymAverage.count} score{gymAverage.count === 1 ? '' : 's'} in
            </div>
          </div>
        )}

        {(slot.workouts.coach_notes || slot.workouts.scaling_notes) && (
          <div className="hw-card-dark" style={{ marginTop: 12 }}>
            <span className="hw-label" style={{ color: 'var(--hw-cyan)' }}>COACH&apos;S NOTE</span>
            {slot.workouts.coach_notes && (
              <p style={{ fontSize: 13, margin: '8px 0 0' }}>{slot.workouts.coach_notes}</p>
            )}
            {slot.workouts.scaling_notes && (
              <p style={{ fontSize: 13, margin: '8px 0 0' }}>
                <strong>Scaling: </strong>
                {slot.workouts.scaling_notes}
              </p>
            )}
          </div>
        )}
      </div>
      <TabBar boardHref={`/leaderboard/${slot.workouts.id}`} />
    </main>
  );
}
