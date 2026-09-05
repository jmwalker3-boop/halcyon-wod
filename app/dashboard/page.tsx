import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
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
            date, day_type, target_modalities,
            workouts (
              title, raw_text, is_benchmark,
              workout_movements ( movements ( canonical_name, equipment, skill_category ) )
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
      .map((wm: any) => wm.movements)
      .filter(Boolean)
      .map((m: any) => ({
        name: m.canonical_name,
        equipment: m.equipment ?? [],
        skillCategory: m.skill_category ?? undefined,
      }));
    return resolveWorkoutForAthlete(toResolve, owned, rx);
  }

  const isCoachOrAdmin = profile?.role === 'coach' || profile?.role === 'admin';

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

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/logo-dot.png" alt="HalcyonWod" style={{ width: 52, height: 52, flex: 'none', objectFit: 'contain' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="hw-h1" style={{ fontSize: 22 }}>{todayLabel}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {isCoachOrAdmin && <Link href="/coach" className="hw-link-back">Coach Deck</Link>}
            <Link href="/movements" className="hw-link-back">Movements</Link>
            <Link href="/settings" className="hw-link-back">Setup</Link>
          </div>
        </div>

        <p className="hw-lede" style={{ fontSize: 15, fontWeight: 700 }}>
          Hey{profile?.display_name ? ` ${profile.display_name}` : ''} — you&apos;re up.
        </p>
        {isCoachOrAdmin && <p className="hw-pill hw-pill-outline" style={{ marginTop: 4 }}>{profile?.role}</p>}

        {(!enrollments || enrollments.length === 0) && (
          <div className="hw-card" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>Not enrolled in a program yet.</p>
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
                    {isCoachOrAdmin && (
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
                          <span className="hw-label">{isToday ? "TODAY'S WOD" : 'WOD'}</span>
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
                        </div>
                      </div>
                    ) : (
                      <p className="hw-muted" style={{ marginTop: 10 }}>Not generated yet.</p>
                    )}

                    {slot.workouts && !hasRecordedEquipment && (
                      <div className="hw-card" style={{ marginTop: 10, background: 'var(--hw-violet)', color: 'var(--hw-paper)' }}>
                        <p style={{ margin: 0, fontSize: 13 }}>
                          Add your equipment and skill level to see your actual Rx for this workout.
                        </p>
                        <Link href="/settings" className="hw-btn hw-btn-mustard" style={{ marginTop: 12, fontSize: 14, padding: 12 }}>
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
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {gaps.map((g) => (
                            <div key={g.prescribedName} style={{ fontSize: 13 }}>
                              {g.prescribedName} — you don&apos;t have: {g.missingEquipment.join(', ')}
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
    </main>
  );
}
