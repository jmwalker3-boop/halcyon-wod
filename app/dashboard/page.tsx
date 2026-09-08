import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import TabBar from '@/components/TabBar';
import {
  normalizeEquipmentTag,
  resolveWorkoutForAthlete,
  type AthleteSkillLevel,
  type MovementRef,
  type MovementToResolve,
  type OwnedEquipment,
  type ResolvedMovement,
  type RxContext,
  type SkillCategory,
} from '@blackboxmethod/equipment-resolver';

// Read-only v0: shows the signed-in athlete's active enrollments and
// today's workout, if today is a scheduled on-day with a committed
// workout. Everything here goes through the anon-key server client, so
// it's exactly as restricted as the athlete's own RLS policies say it
// should be (20260903150000_row_level_security.sql, section 5, plus
// profile_equipment's own "read own" policy) -- no special-casing needed
// here for "can this athlete see this."
//
// Equipment-resolver wired in 2026-09-04; extended the same day with real
// skill-level and equipment SUBSTITUTION (not just gap-flagging), per
// John's request for a settings page (see app/settings/page.tsx) that
// actually changes what /dashboard shows. Reference data
// (movement_scales, movement_equipment_substitutes, and the full
// movements table) is fetched flat and joined client-side here rather than
// via Supabase's nested-embed syntax, since movement_scales has two FKs
// into movements (movement_id and scale_movement_id) and disambiguating
// that in an embedded select needs an exact constraint-name hint this
// session couldn't verify against a live schema -- a flat fetch + a plain
// JS Map avoids that risk entirely, at the cost of three extra small
// queries (movements ~130 rows, movement_scales ~100 rows,
// movement_equipment_substitutes ~40 rows -- all reference data, same
// "authenticated read" RLS policy as the rest of the movement catalog).
//
// Still deliberately partial: only what a committed workout_movements row
// actually carries (movement identity + skill_category) can be resolved.
// Load ROUNDING still needs a structured prescribed_load per movement,
// which only exists on an AI draft's draft_sequence before commit -- see
// the equipment-resolver README/architecture notes -- so every call below
// omits prescribedLoad and 'rounded'/'needs_load_data' still can't occur
// here, same limitation as before. What's new: 'scaled' now can.
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase.from('profiles').select('display_name, role').eq('id', user.id).single();

  const today = new Date().toISOString().slice(0, 10);

  // Active program_cycles for programs this athlete is actively enrolled in,
  // joined out to today's calendar_slot (if any) and that slot's workout --
  // now also pulling each workout's movements' skill_category, for the
  // skill-level scaling pass below.
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
            id, date, day_type, target_modalities,
            workouts (
              id, title, raw_text, is_benchmark, coach_notes, scaling_notes,
              workout_movements ( prescribed_distance_m, prescribed_calories, movements ( canonical_name, equipment, skill_category ) )
            )
          )
        )
      )
    `,
    )
    .eq('profile_id', user.id)
    .eq('active', true);

  const [
    { data: ownedTagRows },
    { data: ownedLoadRows },
    { data: skillLevelRows },
    { data: allMovementRows },
    { data: movementScaleRows },
    { data: equipmentSubstituteRows },
  ] = await Promise.all([
    supabase.from('profile_equipment').select('equipment_tag').eq('profile_id', user.id),
    supabase.from('profile_equipment_loads').select('equipment_tag, load_value, unit, quantity').eq('profile_id', user.id),
    supabase.from('profile_skill_levels').select('skill_category, level').eq('profile_id', user.id),
    supabase.from('movements').select('id, canonical_name, equipment'),
    supabase.from('movement_scales').select('movement_id, tier, scale_movement_id'),
    supabase.from('movement_equipment_substitutes').select('movement_id, substitute_id'),
  ]);

  // Distinct from "recorded equipment that doesn't cover this movement" --
  // an athlete who hasn't gone through equipment setup at all shouldn't see
  // every single movement flagged as missing gear, which would read as
  // broken rather than as "you haven't told us what you have yet."
  const hasRecordedEquipment = (ownedTagRows?.length ?? 0) > 0;
  const owned: OwnedEquipment = {
    tags: new Set((ownedTagRows ?? []).map((r: any) => normalizeEquipmentTag(r.equipment_tag))),
    loadsByTag: new Map(),
  };
  for (const row of (ownedLoadRows ?? []) as any[]) {
    const tag = normalizeEquipmentTag(row.equipment_tag);
    const list = owned.loadsByTag.get(tag) ?? [];
    list.push({ value: Number(row.load_value), unit: row.unit, quantity: row.quantity });
    owned.loadsByTag.set(tag, list);
  }

  const skillLevels = new Map<SkillCategory, AthleteSkillLevel>(
    (skillLevelRows ?? []).map((r: any) => [r.skill_category as SkillCategory, r.level as AthleteSkillLevel]),
  );

  // id -> {name, equipment}, so movement_scales/movement_equipment_substitutes
  // (which only carry ids) can be turned into the name-keyed MovementRef maps
  // resolveWorkoutForAthlete expects.
  const movementById = new Map<string, MovementRef>(
    (allMovementRows ?? []).map((m: any) => [m.id, { name: m.canonical_name, equipment: m.equipment ?? [] }]),
  );

  const skillSubstitutes: RxContext['skillSubstitutes'] = new Map();
  for (const row of (movementScaleRows ?? []) as any[]) {
    const movement = movementById.get(row.movement_id);
    const scale = movementById.get(row.scale_movement_id);
    if (!movement || !scale) continue;
    const key = movement.name.toLowerCase();
    const entry = skillSubstitutes.get(key) ?? {};
    entry[row.tier as 'intermediate' | 'beginner'] = scale;
    skillSubstitutes.set(key, entry);
  }

  const equipmentSubstitutes: RxContext['equipmentSubstitutes'] = new Map();
  for (const row of (equipmentSubstituteRows ?? []) as any[]) {
    const movement = movementById.get(row.movement_id);
    const substitute = movementById.get(row.substitute_id);
    if (!movement || !substitute) continue;
    equipmentSubstitutes.set(movement.name.toLowerCase(), substitute);
  }

  const rx: RxContext = { skillLevels, skillSubstitutes, equipmentSubstitutes };

  function resolveSlotEquipment(slot: any): ResolvedMovement[] {
    const toResolve: MovementToResolve[] = (slot.workouts?.workout_movements ?? [])
      .filter((wm: any) => wm.movements)
      .map((wm: any) => ({
        name: wm.movements.canonical_name,
        equipment: wm.movements.equipment ?? [],
        skillCategory: wm.movements.skill_category ?? undefined,
        prescribedDistanceM: wm.prescribed_distance_m ?? undefined,
        prescribedCalories: wm.prescribed_calories ?? undefined,
      }));
    return resolveWorkoutForAthlete(toResolve, owned, rx);
  }

  // Admin-only, not "coach or admin" -- John's own call (2026-09-05): a
  // future assistant coach should be able to have an account without
  // getting Coach Deck / internal-programming-jargon visibility, so that
  // gate now checks the top-level role specifically rather than treating
  // 'coach' and 'admin' as equivalent. His own account was promoted from
  // 'coach' to 'admin' in the same pass. Nothing athlete-facing (this page,
  // /settings, /movements) is role-gated at all, so an admin still sees
  // everything an athlete does automatically -- there was nothing to widen
  // there.
  const isAdmin = profile?.role === 'admin';

  const todayLabel = new Date(`${today}T00:00:00`)
    .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase()
    .replace(',', ' ·');

  // "STREAK · N ON-DAYS" (mockup 2a) -- consecutive calendar days with at
  // least one workout_log, counted backward from today. If nothing's
  // logged yet today, the streak still counts through yesterday (an
  // athlete's streak shouldn't drop to zero every morning before they've
  // had a chance to log) but breaks the moment a day is actually skipped.
  // 60 rows is generous headroom for real gaps between logged days while
  // staying a single small query.
  const { data: recentLogDateRows } = await supabase
    .from('workout_logs')
    .select('performed_at')
    .eq('profile_id', user.id)
    .order('performed_at', { ascending: false })
    .limit(60);
  const loggedDates = new Set((recentLogDateRows ?? []).map((r: any) => String(r.performed_at).slice(0, 10)));
  let streakDays = 0;
  {
    const cursor = new Date(`${today}T00:00:00`);
    if (!loggedDates.has(today)) cursor.setDate(cursor.getDate() - 1);
    while (loggedDates.has(cursor.toISOString().slice(0, 10))) {
      streakDays += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
  }

  // Recent PR banner (mockup 2a's "new sticker earned" card) -- real data,
  // just without the sticker-sheet mechanic itself (no UI for that exists
  // anywhere yet). Only shown if it actually happened this week, so this
  // doesn't turn into a permanent fixture pointing at an old lift.
  const { data: recentPr } = await supabase
    .from('personal_records')
    .select('value, record_type, achieved_at, movements ( canonical_name )')
    .eq('profile_id', user.id)
    .order('achieved_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const recentPrIsThisWeek =
    recentPr != null && Date.now() - new Date(recentPr.achieved_at).getTime() < 7 * 86400000;

  // Landing shows TODAY only, nothing else (John's request, 2026-09-07:
  // "Landing page should show 'Today's wod' card, but no other wods" --
  // the rest of the week moved to /wod's own date-paged view, reached by
  // "Tomorrow's WOD"-style next/prev links there). Same "first matching
  // enrollment/cycle wins" lookup /wod and /board already use, so all
  // three agree on which slot counts as "today" for a given athlete.
  let todayContext: { slot: any; cycle: any; programName: string | null } | null = null;
  for (const enrollment of (enrollments ?? []) as any[]) {
    for (const cycle of enrollment.programs?.program_cycles ?? []) {
      const slot = (cycle.calendar_slots ?? []).find((s: any) => s.date === today);
      if (slot) {
        todayContext = { slot, cycle, programName: enrollment.programs?.name ?? null };
        break;
      }
    }
    if (todayContext) break;
  }

  let dayNumber = 0;
  let totalWeeks = 0;
  let weekNumber = 0;
  let gaps: ResolvedMovement[] = [];
  let scaled: ResolvedMovement[] = [];
  if (todayContext) {
    const { slot, cycle } = todayContext;
    dayNumber =
      Math.floor((new Date(`${today}T00:00:00`).getTime() - new Date(`${cycle.start_date}T00:00:00`).getTime()) / 86400000) + 1;
    totalWeeks = Math.ceil((cycle.length_days ?? 0) / 7);
    weekNumber = Math.ceil(dayNumber / 7);
    if (slot.workouts) {
      const resolved = resolveSlotEquipment(slot);
      scaled = resolved.filter((r) => r.status === 'scaled');
      gaps = resolved.filter((r) => r.status === 'needs_substitution');
    }
  }

  // Mini podium for the Board card (John's request, 2026-09-08: "make sure
  // the 'board' card contains the graphic, not just a link") -- same
  // podium visual language as /leaderboard's own top-3, just compact.
  // Prefers whichever result_type ('time' or 'rounds_reps') actually has
  // entries for today's workout; 'load' is per-movement with no single
  // ranking, so it's not eligible for this preview.
  let podiumEntries: { name: string; score: string }[] = [];
  if (todayContext?.slot.workouts) {
    const { data: todayLogRows } = await supabase
      .from('workout_logs')
      .select('result_type, result_value, profiles ( display_name )')
      .eq('workout_id', todayContext.slot.workouts.id)
      .in('result_type', ['time', 'rounds_reps']);
    const timeRows = (todayLogRows ?? []).filter((r: any) => r.result_type === 'time');
    const roundsRepsRows = (todayLogRows ?? []).filter((r: any) => r.result_type === 'rounds_reps');
    if (timeRows.length > 0) {
      podiumEntries = timeRows
        .sort((a: any, b: any) => a.result_value.seconds - b.result_value.seconds)
        .slice(0, 3)
        .map((r: any) => ({
          name: r.profiles?.display_name ?? 'Athlete',
          score: `${Math.floor(r.result_value.seconds / 60)}:${String(r.result_value.seconds % 60).padStart(2, '0')}`,
        }));
    } else if (roundsRepsRows.length > 0) {
      podiumEntries = roundsRepsRows
        .sort(
          (a: any, b: any) =>
            b.result_value.rounds * 1000 + b.result_value.reps - (a.result_value.rounds * 1000 + a.result_value.reps),
        )
        .slice(0, 3)
        .map((r: any) => ({
          name: r.profiles?.display_name ?? 'Athlete',
          score: `${r.result_value.rounds}+${r.result_value.reps}`,
        }));
    }
  }
  const PODIUM_BG = ['var(--hw-mustard)', 'var(--hw-paper)', 'var(--hw-orange)'];
  const PODIUM_ORDER = [2, 1, 3];

  return (
    <main className="hw-shell">
      <div className="hw-wrap" style={{ paddingBottom: 100 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/dashboard" style={{ flex: 'none', lineHeight: 0 }}>
            <img src="/logo-dot.png" alt="HalcyonWod" style={{ width: 52, height: 52, objectFit: 'contain' }} />
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="hw-h1" style={{ fontSize: 22 }}>{todayLabel}</div>
          </div>
          {streakDays > 0 && (
            <div
              title={`${streakDays} on-day streak`}
              style={{
                width: 44,
                height: 44,
                flex: 'none',
                borderRadius: '50%',
                border: '3px solid var(--hw-ink)',
                background: 'var(--hw-mustard)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                font: '700 13px/1 "Space Mono", monospace',
              }}
            >
              {streakDays}
            </div>
          )}
        </div>

        {/* Coach Deck / PRs / Chat / Billing / Account / Log out all dropped
            from here, 2026-09-07 (John's call: "remove redundant buttons on
            the top") -- PRs/Chat/Account are already one tap away via the
            bottom TabBar, Billing and Log out already live on /account, and
            Coach Deck moved onto /admin (still gets there from Admin, just
            not duplicated on every dashboard load). Admin is the one entry
            point with nowhere else to live, so it's the only one left. */}
        {isAdmin && (
          <div style={{ marginTop: 12 }}>
            <Link href="/admin" className="hw-link-back">Admin</Link>
          </div>
        )}

        <p className="hw-h2" style={{ fontSize: 17, marginTop: 16 }}>
          HEY{profile?.display_name ? ` ${profile.display_name.toUpperCase()}` : ''} — YOU&apos;RE UP.
        </p>
        {streakDays > 0 && (
          <p className="hw-lede" style={{ fontSize: 13 }}>
            Streak · {streakDays} on-day{streakDays === 1 ? '' : 's'}.
          </p>
        )}
        {isAdmin && <p className="hw-pill hw-pill-outline" style={{ marginTop: 4 }}>{profile?.role}</p>}

        {recentPrIsThisWeek && recentPr && (
          <div className="hw-card" style={{ marginTop: 12, background: 'var(--hw-mustard)', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div
              style={{
                width: 44,
                height: 44,
                flex: 'none',
                borderRadius: '50%',
                border: '3px solid var(--hw-ink)',
                background: 'var(--hw-paper)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
              }}
            >
              🏆
            </div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>
              {(recentPr as any).movements?.canonical_name ?? 'New lift'} {recentPr.value} — new PR!
            </p>
          </div>
        )}

        {(!enrollments || enrollments.length === 0) && (
          <div className="hw-card" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>Not enrolled in a program yet.</p>
            <Link href="/onboarding" className="hw-btn hw-btn-dark" style={{ marginTop: 12, fontSize: 14, padding: 12 }}>
              Get set up →
            </Link>
          </div>
        )}

        {enrollments && enrollments.length > 0 && !todayContext && (
          <div className="hw-card" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>No workout scheduled today.</p>
          </div>
        )}

        {todayContext && (
          <div style={{ marginTop: 16 }}>
            <span className="hw-eyebrow">
              {todayContext.programName ? `${todayContext.programName} · ` : ''}TODAY · DAY {dayNumber}
              {totalWeeks ? ` · WEEK ${weekNumber} OF ${totalWeeks}` : ''}
            </span>

            {/* day_type/target_modalities are internal programming labels --
                coach-facing only, per John's note (2026-09-04): an athlete
                doesn't need to see "Training · M/G" jargon. */}
            {isAdmin && (
              <p className="hw-muted" style={{ fontSize: 12, marginTop: 8 }}>
                {todayContext.slot.day_type} · {todayContext.slot.target_modalities?.join('/') || 'no modality target'}
              </p>
            )}

            {todayContext.slot.workouts ? (
              // Landing preview only (John's request, 2026-09-07: "the wod
              // and 'as written' and 'my rx' stuff should all be under the
              // 'wod (skull)' page") -- title + gap/sub pills, same navy
              // hero card, but the toggle, movement cards, scoring, gym
              // average, and coach's note all live on app/wod/page.tsx.
              // This card is just a preview with a CTA into that page.
              <div style={{ marginTop: 10 }}>
                <Link href="/wod" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                  <div className="hw-card-dark" style={{ padding: 0, overflow: 'hidden' }}>
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
                      <span className="hw-label" style={{ color: 'var(--hw-ink)' }}>TODAY&apos;S WOD</span>
                      {todayContext.slot.workouts.is_benchmark && <span className="hw-pill hw-pill-dark">Benchmark</span>}
                    </div>
                    <div style={{ padding: '18px 16px' }}>
                      <div className="hw-h1" style={{ fontSize: 30, textShadow: '3px 3px 0 var(--hw-pink)' }}>
                        {todayContext.slot.workouts.title ?? 'TODAY’S WOD'}
                      </div>
                      {/* Landing card shows the workout itself now, not just
                          the title (John's request, 2026-09-07: "the
                          'Today's WOD' card on the landing page should show
                          the wod") -- still just the raw text, no toggle/
                          scoring/gym-average, which stay behind the tap
                          into /wod. */}
                      <pre
                        style={{
                          whiteSpace: 'pre-wrap',
                          font: '700 12px/1.7 "Space Mono", monospace',
                          color: 'var(--hw-paper)',
                          margin: '10px 0 0',
                        }}
                      >
                        {todayContext.slot.workouts.raw_text ?? '(no content yet)'}
                      </pre>
                      {hasRecordedEquipment && (
                        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                          {gaps.length > 0 && (
                            <span className="hw-pill hw-pill-pink">{gaps.length} GAP{gaps.length === 1 ? '' : 'S'} FOR YOU</span>
                          )}
                          {scaled.length > 0 && (
                            <span className="hw-pill hw-pill-cyan">{scaled.length} SUB{scaled.length === 1 ? '' : 'S'} FOR YOU</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
                <Link href="/wod" className="hw-btn hw-btn-mustard" style={{ marginTop: 10, fontSize: 14, padding: 12 }}>
                  Open today&apos;s WOD →
                </Link>

                {/* Board card, back under Today's WOD (John's request,
                    2026-09-08) -- goes through /board rather than a direct
                    /leaderboard/[id] link, same resolver app/board/page.tsx
                    already uses for the bottom TabBar's Board tab, so this
                    card and that tab always agree on which workout "today's
                    board" means. */}
                <Link href="/board" style={{ display: 'block', textDecoration: 'none', color: 'inherit', marginTop: 10 }}>
                  <div className="hw-card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div
                      style={{
                        padding: '12px 16px',
                        borderBottom: '4px solid var(--hw-ink)',
                        background: 'var(--hw-violet)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span className="hw-label" style={{ color: 'var(--hw-paper)' }}>Board</span>
                    </div>
                    <div style={{ padding: '14px 16px' }}>
                      {podiumEntries.length > 0 ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                          {podiumEntries.map((e, i) => (
                            <div
                              key={i}
                              style={{
                                flex: i === 0 ? 1.15 : 1,
                                order: PODIUM_ORDER[i],
                                background: PODIUM_BG[i],
                                border: '3px solid var(--hw-ink)',
                                borderRadius: '10px 10px 0 0',
                                padding: i === 0 ? '10px 6px' : '8px 6px',
                                textAlign: 'center',
                                minWidth: 0,
                              }}
                            >
                              <div style={{ font: `400 ${i === 0 ? 20 : 15}px/1 Bungee, sans-serif` }}>{i + 1}</div>
                              <div
                                style={{
                                  font: '700 9px/1.4 "Space Mono", monospace',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {e.name}
                              </div>
                              <div style={{ font: `700 ${i === 0 ? 12 : 11}px/1.3 "Space Mono", monospace` }}>{e.score}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p style={{ margin: 0, fontSize: 13 }}>No scores yet — be the first.</p>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                        <span className="hw-h2" style={{ fontSize: 14 }}>See the board →</span>
                      </div>
                    </div>
                  </div>
                </Link>
              </div>
            ) : (
              <p className="hw-muted" style={{ marginTop: 10 }}>Not generated yet.</p>
            )}
          </div>
        )}
      </div>
      <TabBar />
    </main>
  );
}
