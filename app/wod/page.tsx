import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import ScoreForm from '@/components/ScoreForm';
import WodTabs from '@/components/WodTabs';
import TabBar from '@/components/TabBar';
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

// Today's WOD, split out of /dashboard (John's request, 2026-09-07):
// "'Today's wod' is a great landing, but the wod and 'as written' and 'my
// rx' stuff should all be under the 'wod (skull)' page." /dashboard keeps
// the hero card as a preview; everything interactive (the As Written/My
// Rx toggle, per-movement cards, scoring, gym average, coach's note)
// lives here instead. Query logic is the same as dashboard's, just scoped
// to one day at a time -- this page has no reason to know about the rest
// of the week except to link to it.
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
            id, date, day_type, target_modalities,
            workouts (
              id, title, raw_text, is_benchmark, coach_notes, scaling_notes, result_type_override,
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

  // Same worst-tier-across-touched-categories logic as dashboard's
  // tierForSlot -- kept in sync manually since there's no shared lib
  // helper for it yet (both call sites are small).
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

  function formatSeconds(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  const skillLabelByCategory = new Map(SKILL_CATEGORIES.map((c) => [c.key, c.label]));

  function skillLevelForMovement(_r: ResolvedMovement): string | null {
    for (const [category, level] of skillLevels) {
      if (level !== 'rx') return `${skillLabelByCategory.get(category) ?? category} · ${level}`;
    }
    return null;
  }

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
          <div style={{ borderTop: '3px dashed var(--hw-ink)', padding: '12px 14px' }}>
            {/* "Try Instead:" (John's request, 2026-09-07: the bare pills
                "didn't read as a substitution") -- these options had no
                label at all before, so nothing told the athlete what
                they were looking at. */}
            <span className="hw-label" style={{ display: 'block', marginBottom: 8 }}>Try Instead:</span>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {r.machineScaleOptions.map((o) => (
                <span key={o.machine} className="hw-pill hw-pill-dark">
                  {o.unisex ? `${o.value}${o.unit === 'cal' ? ' CAL' : 'M'}` : `${o.male}/${o.female}${o.unit === 'cal' ? ' CAL' : 'M'}`} {o.machine.toUpperCase()}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Find the target day's slot -- first enrollment/cycle whose
  // calendar_slots contains it, same "one program" assumption the rest of
  // the app makes. undefined if not enrolled, or enrolled but no slot
  // that day.
  let daySlot: any = null;
  for (const enrollment of (enrollments ?? []) as any[]) {
    for (const cycle of enrollment.programs?.program_cycles ?? []) {
      const slot = (cycle.calendar_slots ?? []).find((s: any) => s.date === targetDate);
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
    return (
      <main className="hw-shell">
        <div className="hw-wrap" style={{ paddingBottom: 100 }}>
          <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
          <div className="hw-h1" style={{ fontSize: 26, marginTop: 12 }}>{dayTitle}</div>
          {dayNav}
          <div className="hw-card" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>Nothing scheduled {targetDate === today ? 'for today' : 'that day'}.</p>
          </div>
        </div>
        <TabBar />
      </main>
    );
  }

  const { slot } = daySlot;
  const resolved = resolveSlotEquipment(slot);
  const scaled = resolved.filter((r) => r.status === 'scaled');
  const gaps = resolved.filter((r) => r.status === 'needs_substitution');

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

  return (
    <main className="hw-shell">
      <div className="hw-wrap" style={{ paddingBottom: 100 }}>
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
            lockedResultType={slot.workouts.result_type_override}
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
