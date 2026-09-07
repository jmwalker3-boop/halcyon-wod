import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LogoutButton from '@/components/LogoutButton';
import ScoreForm from '@/components/ScoreForm';
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
//
// Hero header + streak strip + quick actions + bottom tab bar added
// 2026-09-07 to match the "HalcyonWod Mockups" design (screen 2a/1b) --
// John shared a screenshot and said "want the landing to look like
// this." Streak and the weekly on-days count are real (workout_logs.performed_at),
// not fabricated -- see computeStreak below. The mock's sticker/achievement
// banner ("Back squat 315 lb — new sticker earned") is NOT built: that
// needs an achievements/stickers table and detection logic that doesn't
// exist yet, deliberately out of scope for a visual pass.
const STREAK_COLORS = ['pink', 'mustard', 'cyan', 'violet', 'orange'] as const;

function dayWeekInfo(date: string, cycle: { start_date: string; length_days: number }) {
  const dayNumber =
    Math.floor(
      (new Date(`${date}T00:00:00`).getTime() - new Date(`${cycle.start_date}T00:00:00`).getTime()) / 86400000,
    ) + 1;
  const totalWeeks = Math.ceil((cycle.length_days ?? 0) / 7);
  const weekNumber = Math.ceil(dayNumber / 7);
  return { dayNumber, totalWeeks, weekNumber };
}

// Consecutive on-days ending today (or ending yesterday, if today just
// hasn't been logged yet -- an athlete mid-morning shouldn't see their
// streak drop to zero before they've even had a chance to train).
function computeStreak(loggedDates: Set<string>, todayISO: string): number {
  let streak = 0;
  const cursor = new Date(`${todayISO}T00:00:00`);
  if (!loggedDates.has(todayISO)) cursor.setDate(cursor.getDate() - 1);
  while (loggedDates.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

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
    { data: logDateRows },
  ] = await Promise.all([
    supabase.from('profile_equipment').select('equipment_tag').eq('profile_id', user.id),
    supabase.from('profile_equipment_loads').select('equipment_tag, load_value, unit, quantity').eq('profile_id', user.id),
    supabase.from('profile_skill_levels').select('skill_category, level').eq('profile_id', user.id),
    supabase.from('movements').select('id, canonical_name, equipment'),
    supabase.from('movement_scales').select('movement_id, tier, scale_movement_id'),
    supabase.from('movement_equipment_substitutes').select('movement_id, substitute_id'),
    // Last 60 days of this athlete's own logged dates -- enough to cover any
    // realistic streak and the 7-day strip, without scanning the whole table.
    supabase
      .from('workout_logs')
      .select('performed_at')
      .eq('profile_id', user.id)
      .gte('performed_at', new Date(Date.now() - 60 * 86400000).toISOString()),
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

  const loggedDates = new Set((logDateRows ?? []).map((r: any) => new Date(r.performed_at).toISOString().slice(0, 10)));
  const streak = computeStreak(loggedDates, today);
  const last7Dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T00:00:00`);
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });

  // Monday-start week, for "N on-days logged this week."
  const weekStart = new Date(`${today}T00:00:00`);
  const isoDow = weekStart.getDay() === 0 ? 7 : weekStart.getDay();
  weekStart.setDate(weekStart.getDate() - (isoDow - 1));
  const onDaysThisWeek = [...loggedDates].filter((d) => d >= weekStart.toISOString().slice(0, 10) && d <= today).length;

  const firstEnrollment = enrollments?.[0] as any;
  const firstProgram = firstEnrollment?.programs;
  const firstAllEntries = (firstProgram?.program_cycles ?? []).flatMap((cycle: any) =>
    (cycle.calendar_slots ?? []).map((slot: any) => ({ slot, cycle })),
  );
  const todayEntry = firstAllEntries.find((e: any) => e.slot.date === today);
  const todayResolved = todayEntry?.slot.workouts ? resolveSlotEquipment(todayEntry.slot) : [];
  const todayScaled = todayResolved.filter((r) => r.status === 'scaled');
  const todayGaps = todayResolved.filter((r) => r.status === 'needs_substitution');
  const todaySubCount = todayScaled.length + todayGaps.length;
  const todayDayWeek = todayEntry ? dayWeekInfo(today, todayEntry.cycle) : null;
  const boardHref = todayEntry?.slot.workouts ? `/leaderboard/${todayEntry.slot.workouts.id}` : undefined;

  return (
    <main className="hw-shell">
      <div className="hw-wrap" style={{ paddingBottom: 110 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* Movement Library (app/movements) deliberately unlinked here, 2026-09-06 --
              John's call: it doesn't need to be athlete-facing, possibly doesn't need to
              exist at all. Route itself left in place (harmless, unreachable without a
              direct link) rather than deleted, since he hasn't decided that part yet. */}
          {isAdmin && <Link href="/coach" className="hw-link-back">Coach Deck</Link>}
          {isAdmin && <Link href="/admin" className="hw-link-back">Admin</Link>}
          <Link href="/chat" className="hw-link-back">Chat</Link>
          <Link href="/billing" className="hw-link-back">Billing</Link>
          <LogoutButton />
        </div>

        {/* Hero header -- logo top-left, date/day-week/track name centered,
            streak count top-right. Matches the mockup's 2a/1b "Home" screen. */}
        <div style={{ position: 'relative', marginTop: 12, textAlign: 'center' }}>
          <Link href="/dashboard" style={{ position: 'absolute', left: 0, top: 0, lineHeight: 0 }}>
            <img src="/logo-dot.png" alt="HalcyonWod" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          </Link>
          <div
            style={{
              position: 'absolute',
              right: 0,
              top: 0,
              width: 44,
              height: 44,
              borderRadius: '50%',
              background: 'var(--hw-mustard)',
              border: '3px solid var(--hw-ink)',
              boxShadow: '3px 3px 0 var(--hw-ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              font: '700 16px/1 "Space Mono", monospace',
            }}
            title="Current streak, on-days"
          >
            {streak}
          </div>
          <div className="hw-h1" style={{ fontSize: 22, margin: '4px 0 0' }}>{todayLabel}</div>
          {todayDayWeek && (
            <span className="hw-pill hw-pill-dark" style={{ marginTop: 8 }}>
              DAY {todayDayWeek.dayNumber}
              {todayDayWeek.totalWeeks ? ` · WEEK ${todayDayWeek.weekNumber} OF ${todayDayWeek.totalWeeks}` : ''}
            </span>
          )}
          {firstProgram?.name && (
            <div className="hw-label" style={{ marginTop: 6, opacity: 0.7 }}>{firstProgram.name.toUpperCase()}</div>
          )}
        </div>

        <p className="hw-lede" style={{ fontSize: 15, fontWeight: 700, textAlign: 'center' }}>
          Hey{profile?.display_name ? ` ${profile.display_name}` : ''} — you&apos;re up.
        </p>
        <p className="hw-muted" style={{ fontSize: 13, textAlign: 'center', marginTop: 4 }}>
          {onDaysThisWeek} on-day{onDaysThisWeek === 1 ? '' : 's'} logged this week. No excuses, chief.
        </p>
        {isAdmin && (
          <p className="hw-pill hw-pill-outline" style={{ marginTop: 8, display: 'block', textAlign: 'center' }}>
            {profile?.role}
          </p>
        )}

        {(!enrollments || enrollments.length === 0) && (
          <div className="hw-card" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>Not enrolled in a program yet.</p>
          </div>
        )}

        {/* Today's WOD hero card -- mustard header, dark body, Bungee title,
            sub-count/Rx pill, "Open the board" CTA. Everything on it is real
            (title/raw_text from workouts, sub count from the resolver above) --
            the mock's "FOR TIME" format pill was dropped since the schema
            doesn't carry a structured workout format, only raw_text. */}
        {todayEntry?.slot.workouts && (
          <div className="hw-card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
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
              <span className="hw-label">Today&apos;s WOD</span>
              {todayEntry.slot.workouts.is_benchmark && <span className="hw-pill hw-pill-dark">Benchmark</span>}
            </div>
            <div style={{ padding: '16px', background: 'var(--hw-navy)' }}>
              {todayEntry.slot.workouts.title && (
                <div
                  style={{
                    font: '400 32px/1.05 "Bungee", "Space Grotesk", sans-serif',
                    color: 'var(--hw-mustard)',
                    textShadow: '3px 3px 0 var(--hw-pink)',
                  }}
                >
                  {todayEntry.slot.workouts.title}
                </div>
              )}
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  font: '700 12px/1.7 "Space Mono", monospace',
                  color: 'var(--hw-cyan)',
                  margin: '12px 0 0',
                }}
              >
                {todayEntry.slot.workouts.raw_text ?? '(no content yet)'}
              </pre>
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {hasRecordedEquipment && todaySubCount > 0 && (
                  <span className="hw-pill hw-pill-pink">
                    {todaySubCount} sub{todaySubCount === 1 ? '' : 's'} for you
                  </span>
                )}
                {hasRecordedEquipment && todaySubCount === 0 && todayResolved.length > 0 && (
                  <span className="hw-pill hw-pill-cyan">Rx as written</span>
                )}
              </div>
            </div>
            {boardHref && (
              <Link href={boardHref} className="hw-btn hw-btn-mustard" style={{ borderRadius: 0, borderTop: 'none' }}>
                Open the board →
              </Link>
            )}
          </div>
        )}

        {todayEntry?.slot.workouts && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
            <a
              href="#today-score-form"
              className="hw-card"
              style={{ textDecoration: 'none', color: 'var(--hw-ink)', display: 'block' }}
            >
              <span style={{ fontSize: 22 }}>●</span>
              <div className="hw-h3" style={{ marginTop: 10 }}>Log a score</div>
            </a>
            {boardHref && (
              <Link
                href={boardHref}
                className="hw-card"
                style={{ textDecoration: 'none', background: 'var(--hw-pink)', color: 'var(--hw-paper)', display: 'block' }}
              >
                <span style={{ fontSize: 22 }}>◆</span>
                <div className="hw-h3" style={{ marginTop: 10, color: 'var(--hw-paper)' }}>The board</div>
              </Link>
            )}
          </div>
        )}

        {/* Streak strip -- last 7 calendar days, filled square if this athlete
            logged a score that day, dashed/empty otherwise. Colors cycle
            through the brand palette rather than meaning anything per-slot. */}
        <div className="hw-card" style={{ marginTop: 12 }}>
          <div className="hw-eyebrow-row">
            <span className="hw-label">Streak · {streak} on-day{streak === 1 ? '' : 's'}</span>
            {streak > 0 && <span className="hw-label" style={{ color: 'var(--hw-pink-deep)' }}>Don&apos;t blow it</span>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            {last7Dates.map((d, i) => {
              const on = loggedDates.has(d);
              return (
                <div
                  key={d}
                  style={{
                    flex: 1,
                    aspectRatio: '1',
                    borderRadius: 8,
                    border: on ? '3px solid var(--hw-ink)' : '2px dashed var(--hw-ink)',
                    background: on ? `var(--hw-${STREAK_COLORS[i % STREAK_COLORS.length]})` : 'transparent',
                    opacity: on ? 1 : 0.4,
                  }}
                />
              );
            })}
          </div>
        </div>

        {todayEntry?.slot.workouts && (
          <div id="today-score-form" style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ScoreForm
              workoutId={todayEntry.slot.workouts.id}
              calendarSlotId={todayEntry.slot.id}
              movements={allMovementRows ?? []}
            />
          </div>
        )}

        {todayEntry?.slot.workouts && !hasRecordedEquipment && (
          <div className="hw-card" style={{ marginTop: 12, background: 'var(--hw-violet)', color: 'var(--hw-paper)' }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              Add your equipment and skill level to see your actual Rx for this workout.
            </p>
            <Link href="/account" className="hw-btn hw-btn-mustard" style={{ marginTop: 12, fontSize: 14, padding: 12 }}>
              Set up your gear →
            </Link>
          </div>
        )}

        {hasRecordedEquipment && todayScaled.length > 0 && (
          <div className="hw-card" style={{ marginTop: 12 }}>
            <span className="hw-label" style={{ color: 'var(--hw-violet)' }}>Your Rx</span>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {todayScaled.map((r) => (
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

        {hasRecordedEquipment && todayGaps.length > 0 && (
          <div className="hw-card" style={{ marginTop: 12 }}>
            <span className="hw-label" style={{ color: 'var(--hw-pink-deep)' }}>Needs a manual scale</span>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {todayGaps.map((g) => (
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

        {/* Admin-only day_type/target_modalities peek for today, same gate as
            the rest-of-week loop below. */}
        {isAdmin && todayEntry && (
          <p className="hw-muted" style={{ fontSize: 12, marginTop: 12 }}>
            {todayEntry.slot.day_type} · {todayEntry.slot.target_modalities?.join('/') || 'no modality target'}
          </p>
        )}

        {enrollments?.map((enrollment: any) => {
          const program = enrollment.programs;
          const allEntries = (program?.program_cycles ?? []).flatMap((cycle: any) =>
            (cycle.calendar_slots ?? []).map((slot: any) => ({ slot, cycle })),
          );
          const byDate = new Map<string, any>(allEntries.map((e: any) => [e.slot.date, e]));
          // Skip today -- it already has its own hero treatment above.
          const weekEntries = weekDates.filter((d) => d !== today).map((date) => ({ date, entry: byDate.get(date) }));

          return (
            <div key={enrollment.program_id} style={{ marginTop: 20 }}>
              <div className="hw-eyebrow-row">
                <span className="hw-h3">Coming up</span>
                <span className="hw-pill hw-pill-outline">Next 6 days</span>
              </div>

              {weekEntries.map(({ date, entry }) => {
                const dateLabel = new Date(`${date}T00:00:00`)
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
                const { dayNumber, totalWeeks, weekNumber } = dayWeekInfo(date, cycle);

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
                        <ScoreForm workoutId={slot.workouts.id} calendarSlotId={slot.id} movements={allMovementRows ?? []} />
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
                              {/* Only present for a missing monostructural machine with a
                                  recorded distance or calorie count (CAP chart conversion,
                                  added 2026-09-06, extended to calories 2026-09-07) --
                                  everything else still falls back to the plain gap message
                                  above with nothing further to suggest.
                                  Row/Ski/Bike/Echo options are fixed male-first ("M/F"),
                                  matching every other sex-split number on this page (barbell
                                  loads read "135/95," male first regardless of which number is
                                  larger). Run is never sex-split at all (John, 2026-09-06:
                                  "Run distances never need to change between M/F ... everyone
                                  runs the same distances") -- it renders as a single unisex
                                  number, computed off the male axis, not a female/male pair,
                                  and always in meters (unit: 'm') even when the source piece
                                  was calorie-based, since you don't "run calories." Non-Run
                                  options carry their own unit ('m' or 'cal') matching whatever
                                  the source movement was prescribed in. */}
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
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <TabBar active="wod" boardHref={boardHref} />
    </main>
  );
}
