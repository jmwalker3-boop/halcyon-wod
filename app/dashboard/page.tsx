import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LogoutButton from '@/components/LogoutButton';
import ScoreForm from '@/components/ScoreForm';
import WodTabs from '@/components/WodTabs';
import { SKILL_CATEGORIES } from '@/lib/equipment';
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
        // Only set on cardio/monostructural pieces (workout_movements.prescribed_distance_m
        // / .prescribed_calories, added 2026-09-06 and 2026-09-07) -- lets the resolver
        // offer real CAP-chart-converted machine options instead of a bare "you don't
        // have: X" when either is recorded. Undefined for everything else, same as
        // before either field existed.
        prescribedDistanceM: wm.prescribed_distance_m ?? undefined,
        prescribedCalories: wm.prescribed_calories ?? undefined,
      }));
    return resolveWorkoutForAthlete(toResolve, owned, rx);
  }

  // The leaderboard's silo filter/badge (mockup 2c) needs one tier per
  // logged score, not the resolver's per-movement scaling detail -- this
  // is the worst (most-scaled) of the athlete's own recorded skill levels
  // across whatever skill categories this workout's movements actually
  // touch. A workout with no gymnastics skill movements at all (e.g. a
  // pure barbell/metcon day) has no relevant categories, so it's 'rx' by
  // definition, not because the athlete happens to be Rx everywhere.
  function tierForSlot(slot: any): AthleteSkillLevel {
    const categories = new Set<SkillCategory>(
      (slot.workouts?.workout_movements ?? [])
        .map((wm: any) => wm.movements?.skill_category)
        .filter(Boolean),
    );
    let worst: AthleteSkillLevel = 'rx';
    for (const category of categories) {
      const level = skillLevels.get(category) ?? 'rx';
      if (level === 'beginner') return 'beginner';
      if (level === 'intermediate') worst = 'intermediate';
    }
    return worst;
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

  // Rolling 7-day-ahead window (today through today+6) -- the product's own
  // pitch (Section 1 of the handover doc) is "everyone sees the same base
  // workout up to 7 days ahead," but this page only ever showed today until
  // now. Built the same way Coach Deck builds its Mon-Sun week: a fixed
  // array of ISO dates, a byDate Map per program built from every cycle's
  // calendar_slots (not just today's), and every one of the 7 dates
  // rendered even when there's no calendar_slot row at all for it yet --
  // that's a real, distinct state from "slot exists but workout not
  // generated," and athletes should be able to tell those apart.
  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });

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

  // "GYM AVERAGE" (mockup 2b) -- average of everyone's 'time' scores on
  // today's specific workout instance, same query shape the leaderboard
  // itself runs. Collected once for every enrollment's today-slot rather
  // than per-render, since a given workout_id only needs this once.
  const todayWorkoutIds = new Set<string>();
  for (const enrollment of (enrollments ?? []) as any[]) {
    for (const cycle of enrollment.programs?.program_cycles ?? []) {
      for (const slot of cycle.calendar_slots ?? []) {
        if (slot.date === today && slot.workouts) todayWorkoutIds.add(slot.workouts.id);
      }
    }
  }
  const { data: gymTimeRows } = todayWorkoutIds.size
    ? await supabase.from('workout_logs').select('workout_id, result_value').in('workout_id', [...todayWorkoutIds]).eq('result_type', 'time')
    : { data: [] as any[] };
  const gymAverageByWorkout = new Map<string, { seconds: number; count: number }>();
  for (const workoutId of todayWorkoutIds) {
    const seconds = (gymTimeRows ?? [])
      .filter((r: any) => r.workout_id === workoutId)
      .map((r: any) => r.result_value.seconds as number);
    if (seconds.length) {
      gymAverageByWorkout.set(workoutId, { seconds: seconds.reduce((a, b) => a + b, 0) / seconds.length, count: seconds.length });
    }
  }

  function formatSeconds(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const skillLabelByCategory = new Map(SKILL_CATEGORIES.map((c) => [c.key, c.label]));

  // One movement's card in the "My Rx" tab (mockup 2b) -- built straight
  // from the resolver's own ResolvedMovement, so the status shown here can
  // never disagree with what resolveWorkoutForAthlete actually decided.
  function renderMovementCard(r: ResolvedMovement) {
    const badge =
      r.status === 'needs_substitution' || r.status === 'needs_load_data'
        ? { label: '?', bg: 'var(--hw-pink)' }
        : r.status === 'scaled'
          ? { label: 'SCALED', bg: 'var(--hw-mustard)' }
          : { label: 'RX', bg: 'var(--hw-cyan)' };

    return (
      <div key={r.prescribedName} className="hw-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'stretch' }}>
          <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
            <div className="hw-h3" style={{ fontSize: 16 }}>{r.displayName.toUpperCase()}</div>
            {r.status === 'scaled' ? (
              <div className="hw-muted" style={{ font: '700 11px/1.6 "Space Mono", monospace' }}>
                WAS: {r.prescribedName.toUpperCase()}
              </div>
            ) : r.status === 'needs_substitution' || r.status === 'needs_load_data' ? (
              <div style={{ font: '700 11px/1.6 "Space Mono", monospace', color: 'var(--hw-pink-deep)' }}>
                {r.status === 'needs_load_data'
                  ? 'NO WEIGHT RECORDED FOR THIS'
                  : `NOT ON YOUR LIST: ${r.missingEquipment.join(', ').toUpperCase()}`}
              </div>
            ) : (
              <div className="hw-muted" style={{ font: '700 11px/1.6 "Space Mono", monospace' }}>
                {r.load ? `${r.load.value} ${r.load.unit.toUpperCase()}` : 'BODYWEIGHT'}
              </div>
            )}
          </div>
          <div
            style={{
              width: 56,
              flex: 'none',
              background: 'var(--hw-ink)',
              color: badge.bg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              font: '700 10px/1.2 "Space Mono", monospace',
            }}
          >
            {badge.label}
          </div>
        </div>
        {r.status === 'scaled' && (
          <div style={{ borderTop: '3px dashed var(--hw-ink)', opacity: 0.7, padding: '10px 14px', font: '400 11px/1.5 "Space Grotesk", sans-serif' }}>
            {r.scaledBecause === 'skill_level' ? (
              <>Your skill level here is <strong>{skillLevelForMovement(r) ?? 'scaled'}</strong>.</>
            ) : (
              'Substituted based on the gear you have on file.'
            )}
          </div>
        )}
        {r.machineScaleOptions && r.machineScaleOptions.length > 0 && (
          <div style={{ borderTop: '3px dashed var(--hw-ink)', padding: '12px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {r.machineScaleOptions.map((o) => (
              <span key={o.machine} className="hw-pill hw-pill-dark">
                {o.unisex ? `${o.value}${o.unit === 'cal' ? ' CAL' : 'M'}` : `${o.male}/${o.female}${o.unit === 'cal' ? ' CAL' : 'M'}`} {o.machine.toUpperCase()}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Best-effort label for the "your X level is Y" note under a
  // skill-scaled movement -- the resolver doesn't carry which category it
  // matched on, so this re-derives it the same way tierForSlot does: the
  // worst skill level among skill categories on this workout that aren't
  // already Rx. That's an approximation (a workout with two non-Rx skill
  // movements would show the same note under both), acceptable since the
  // note is illustrative, not load-bearing the way the badge itself is.
  function skillLevelForMovement(_r: ResolvedMovement): string | null {
    for (const [category, level] of skillLevels) {
      if (level !== 'rx') return `${skillLabelByCategory.get(category) ?? category} · ${level}`;
    }
    return null;
  }

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
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

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {/* Movement Library (app/movements) deliberately unlinked here, 2026-09-06 --
              John's call: it doesn't need to be athlete-facing, possibly doesn't need to
              exist at all. Route itself left in place (harmless, unreachable without a
              direct link) rather than deleted, since he hasn't decided that part yet. */}
          {isAdmin && <Link href="/coach" className="hw-link-back">Coach Deck</Link>}
          {isAdmin && <Link href="/admin" className="hw-link-back">Admin</Link>}
          <Link href="/prs" className="hw-link-back">PRs</Link>
          <Link href="/chat" className="hw-link-back">Chat</Link>
          <Link href="/billing" className="hw-link-back">Billing</Link>
          <Link href="/account" className="hw-link-back">Account</Link>
          <LogoutButton />
        </div>

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

        {enrollments?.map((enrollment: any) => {
          const program = enrollment.programs;
          const allEntries = (program?.program_cycles ?? []).flatMap((cycle: any) =>
            (cycle.calendar_slots ?? []).map((slot: any) => ({ slot, cycle })),
          );
          const byDate = new Map<string, any>(allEntries.map((e: any) => [e.slot.date, e]));
          const weekEntries = weekDates.map((date) => ({ date, entry: byDate.get(date) }));

          return (
            <div key={enrollment.program_id} style={{ marginTop: 16 }}>
              <div className="hw-eyebrow-row">
                <span className="hw-h3">{program?.name}</span>
                <span className="hw-pill hw-pill-outline">Next 7 days</span>
              </div>

              {weekEntries.map(({ date, entry }) => {
                const isToday = date === today;
                const dateLabel = isToday
                  ? 'TODAY'
                  : new Date(`${date}T00:00:00`)
                      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                      .toUpperCase();

                if (!entry) {
                  return (
                    <div key={date} style={{ marginTop: 10 }}>
                      <span className="hw-eyebrow-light">{dateLabel}</span>
                      <p className="hw-muted" style={{ marginTop: 8 }}>No slot scheduled.</p>
                    </div>
                  );
                }

                const { slot, cycle } = entry;
                const resolved = slot.workouts ? resolveSlotEquipment(slot) : [];
                const scaled = resolved.filter((r) => r.status === 'scaled');
                const gaps = resolved.filter((r) => r.status === 'needs_substitution');

                // Day/week-in-cycle -- real numbers derived from the cycle's own
                // start_date + length_days for THIS slot's date, not a fabricated
                // counter and not always relative to today now that every day in
                // the window renders its own card.
                const dayNumber =
                  Math.floor((new Date(`${date}T00:00:00`).getTime() - new Date(`${cycle.start_date}T00:00:00`).getTime()) /
                    86400000) + 1;
                const totalWeeks = Math.ceil((cycle.length_days ?? 0) / 7);
                const weekNumber = Math.ceil(dayNumber / 7);

                return (
                  <div key={date} style={{ marginTop: 10 }}>
                    <span className="hw-eyebrow">
                      {dateLabel} · DAY {dayNumber}{totalWeeks ? ` · WEEK ${weekNumber} OF ${totalWeeks}` : ''}
                    </span>

                    {/* day_type/target_modalities are internal programming labels (which
                        block-day-type and modality-coverage slot this is) -- coach-facing
                        only, per John's note (2026-09-04): an athlete doesn't need to see
                        "Training · M/G" jargon, just the workout itself. is_benchmark stays
                        visible to everyone -- "this is a benchmark" is meaningful to an
                        athlete, not an internal doctrine detail. */}
                    {isAdmin && (
                      <p className="hw-muted" style={{ fontSize: 12, marginTop: 8 }}>
                        {slot.day_type} · {slot.target_modalities?.join('/') || 'no modality target'}
                      </p>
                    )}

                    {!isToday ? (
                      <>
                        {slot.workouts ? (
                          <div className="hw-card" style={{ marginTop: 10, padding: 0, overflow: 'hidden' }}>
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
                              <span className="hw-label">WOD</span>
                              {slot.workouts.is_benchmark && <span className="hw-pill hw-pill-dark">Benchmark</span>}
                            </div>
                            <div style={{ padding: '16px' }}>
                              {slot.workouts.title && <div className="hw-h2">{slot.workouts.title}</div>}
                              <pre
                                style={{
                                  whiteSpace: 'pre-wrap',
                                  font: '700 12px/1.7 "Space Mono", monospace',
                                  color: 'var(--hw-ink)',
                                  margin: '10px 0 0',
                                }}
                              >
                                {slot.workouts.raw_text ?? '(no content yet)'}
                              </pre>
                              {/* Athlete-facing Notes section (John's request, 2026-09-06) --
                                  every WOD gets this when the coach has written either field in
                                  Coach Deck; hidden entirely when both are empty rather than
                                  showing an empty "Notes" header. Deliberately separate from
                                  calendar_slots.override_reason, which is an internal
                                  doctrine-exception reason, not athlete-facing. */}
                              {(slot.workouts.coach_notes || slot.workouts.scaling_notes) && (
                                <div
                                  style={{
                                    marginTop: 14,
                                    paddingTop: 12,
                                    borderTop: '2px solid var(--hw-ink)',
                                  }}
                                >
                                  <span className="hw-label" style={{ color: 'var(--hw-violet)' }}>Notes</span>
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
                          </div>
                        ) : (
                          <p className="hw-muted" style={{ marginTop: 10 }}>Not generated yet.</p>
                        )}

                        {slot.workouts && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <ScoreForm
                              workoutId={slot.workouts.id}
                              calendarSlotId={slot.id}
                              movements={allMovementRows ?? []}
                              tier={tierForSlot(slot)}
                            />
                            <Link href={`/leaderboard/${slot.workouts.id}`} className="hw-link-back" style={{ marginTop: 10 }}>
                              Leaderboard →
                            </Link>
                          </div>
                        )}

                        {slot.workouts && !hasRecordedEquipment && (
                          <div className="hw-card" style={{ marginTop: 10, background: 'var(--hw-violet)', color: 'var(--hw-paper)' }}>
                            <p style={{ margin: 0, fontSize: 13 }}>
                              Add your equipment and skill level to see your actual Rx for this workout.
                            </p>
                            <Link href="/account" className="hw-btn hw-btn-mustard" style={{ marginTop: 12, fontSize: 14, padding: 12 }}>
                              Set up your gear →
                            </Link>
                          </div>
                        )}

                        {hasRecordedEquipment && scaled.length > 0 && (
                          <div className="hw-card" style={{ marginTop: 10 }}>
                            <span className="hw-label" style={{ color: 'var(--hw-violet)' }}>Your Rx</span>
                            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {scaled.map((r) => (
                                <div key={r.prescribedName} style={{ fontSize: 13 }}>
                                  {r.prescribedName} → <strong>{r.displayName}</strong>{' '}
                                  <span className="hw-pill hw-pill-mustard" style={{ marginLeft: 4 }}>
                                    {r.scaledBecause === 'skill_level' ? 'skill' : 'equip sub'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {hasRecordedEquipment && gaps.length > 0 && (
                          <div className="hw-card" style={{ marginTop: 10 }}>
                            <span className="hw-label" style={{ color: 'var(--hw-pink-deep)' }}>Needs a manual scale</span>
                            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {gaps.map((g) => (
                                <div key={g.prescribedName} style={{ fontSize: 13 }}>
                                  <div>
                                    {g.prescribedName} — you don&apos;t have: {g.missingEquipment.join(', ')}
                                  </div>
                                  {g.machineScaleOptions && (
                                    <div className="hw-muted" style={{ marginTop: 4 }}>
                                      Try: {g.machineScaleOptions
                                        .map((o) => {
                                          const suffix = o.unit === 'cal' ? ' Cal' : 'm';
                                          return o.unisex
                                            ? `${o.value}${suffix} ${o.machine}`
                                            : `${o.male}/${o.female}${suffix} ${o.machine} (M/F)`;
                                        })
                                        .join(' · ')}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {hasRecordedEquipment && scaled.length === 0 && gaps.length === 0 && resolved.length > 0 && (
                          <div className="hw-pill hw-pill-cyan" style={{ marginTop: 10 }}>
                            ✓ Rx as written — you have the gear and skill level for this one.
                          </div>
                        )}
                      </>
                    ) : slot.workouts ? (
                      // 2b's "hero" treatment -- today's WOD only. Navy card, big
                      // Bungee title, AS WRITTEN/MY RX toggle over the same
                      // resolver output the other days summarize more tersely,
                      // stats, and the coach's note promoted out of "Notes" into
                      // its own dark card.
                      <div style={{ marginTop: 10 }}>
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
                            {slot.workouts.is_benchmark && <span className="hw-pill hw-pill-dark">Benchmark</span>}
                          </div>
                          <div style={{ padding: '18px 16px' }}>
                            <div className="hw-h1" style={{ fontSize: 30, textShadow: '3px 3px 0 var(--hw-pink)' }}>
                              {slot.workouts.title ?? 'TODAY’S WOD'}
                            </div>
                            {!hasRecordedEquipment ? null : (
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

                        <div style={{ marginTop: 12 }}>
                          <WodTabs
                            asWritten={
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
                            myRx={
                              !hasRecordedEquipment ? (
                                <div className="hw-card" style={{ background: 'var(--hw-violet)', color: 'var(--hw-paper)' }}>
                                  <p style={{ margin: 0, fontSize: 13 }}>
                                    Add your equipment and skill level to see your actual Rx for this workout.
                                  </p>
                                  <Link href="/account" className="hw-btn hw-btn-mustard" style={{ marginTop: 12, fontSize: 14, padding: 12 }}>
                                    Set up your gear →
                                  </Link>
                                </div>
                              ) : resolved.length === 0 ? (
                                <p className="hw-muted">Nothing to resolve for this one.</p>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  {resolved.map((r) => renderMovementCard(r))}
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
                            tier={tierForSlot(slot)}
                          />
                          <Link href={`/leaderboard/${slot.workouts.id}`} className="hw-btn hw-btn-dark" style={{ fontSize: 13, padding: 12 }}>
                            The board →
                          </Link>
                        </div>

                        {gymAverageByWorkout.has(slot.workouts.id) && (
                          <div className="hw-card" style={{ marginTop: 12, background: 'var(--hw-orange)' }}>
                            <span className="hw-label">GYM AVERAGE</span>
                            <div style={{ font: '700 22px/1.3 "Space Mono", monospace', marginTop: 4 }}>
                              {formatSeconds(gymAverageByWorkout.get(slot.workouts.id)!.seconds)}
                            </div>
                            <div style={{ font: '400 10px/1 "Space Mono", monospace' }}>
                              {gymAverageByWorkout.get(slot.workouts.id)!.count} score
                              {gymAverageByWorkout.get(slot.workouts.id)!.count === 1 ? '' : 's'} in
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
                    ) : (
                      <p className="hw-muted" style={{ marginTop: 10 }}>Not generated yet.</p>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </main>
  );
}
