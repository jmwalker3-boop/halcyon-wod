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

  return (
    <main className="container">
      <p>
        <Link href="/settings">Equipment &amp; skill level settings</Link>
      </p>
      <h1>Welcome{profile?.display_name ? `, ${profile.display_name}` : ''}</h1>
      <p className="muted">{profile?.role ?? 'athlete'}</p>

      <h2>Today — {today}</h2>
      {(!enrollments || enrollments.length === 0) && (
        <div className="card">
          <p>Not enrolled in a program yet.</p>
        </div>
      )}

      {enrollments?.map((enrollment: any) => {
        const program = enrollment.programs;
        const todaysSlots = (program?.program_cycles ?? []).flatMap((cycle: any) =>
          (cycle.calendar_slots ?? []).filter((slot: any) => slot.date === today),
        );

        return (
          <div className="card" key={enrollment.program_id}>
            <h3>{program?.name}</h3>
            {todaysSlots.length === 0 && <p className="muted">No workout scheduled today.</p>}
            {todaysSlots.map((slot: any, i: number) => {
              const resolved = slot.workouts ? resolveSlotEquipment(slot) : [];
              const scaled = resolved.filter((r) => r.status === 'scaled');
              const gaps = resolved.filter((r) => r.status === 'needs_substitution');

              return (
                <div key={i}>
                  {/* day_type/target_modalities are internal programming labels (which
                      block-day-type and modality-coverage slot this is) -- coach-facing
                      only, per John's note (2026-09-04): an athlete doesn't need to see
                      "Training · M/G" jargon, just the workout itself. is_benchmark stays
                      visible to everyone -- "this is a benchmark" is meaningful to an
                      athlete, not an internal doctrine detail. */}
                  {isCoachOrAdmin && (
                    <p className="muted">
                      {slot.day_type} · {slot.target_modalities?.join('/') || 'no modality target'}
                    </p>
                  )}
                  {slot.workouts?.is_benchmark && <p className="muted">Benchmark</p>}
                  {slot.workouts ? (
                    <>
                      {slot.workouts.title && <p><strong>{slot.workouts.title}</strong></p>}
                      <pre style={{ whiteSpace: 'pre-wrap' }}>{slot.workouts.raw_text ?? '(no content yet)'}</pre>
                      {!hasRecordedEquipment && (
                        <p className="muted">
                          <Link href="/settings">Add your equipment and skill level</Link> to see your actual Rx for this
                          workout.
                        </p>
                      )}
                      {hasRecordedEquipment && scaled.length > 0 && (
                        <div className="card">
                          <p><strong>Your Rx</strong></p>
                          <ul>
                            {scaled.map((r) => (
                              <li key={r.prescribedName}>
                                {r.prescribedName} → <strong>{r.displayName}</strong>{' '}
                                <span className="muted">
                                  ({r.scaledBecause === 'skill_level' ? 'your skill level' : 'equipment sub'})
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {hasRecordedEquipment && gaps.length > 0 && (
                        <div className="card">
                          <p><strong>Needs a manual scale</strong></p>
                          <ul>
                            {gaps.map((g) => (
                              <li key={g.prescribedName}>
                                {g.prescribedName} — you don&apos;t have: {g.missingEquipment.join(', ')}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {hasRecordedEquipment && scaled.length === 0 && gaps.length === 0 && resolved.length > 0 && (
                        <p className="muted">✓ Rx as written -- you have the equipment and skill level for this workout.</p>
                      )}
                    </>
                  ) : (
                    <p className="muted">Not generated yet.</p>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </main>
  );
}
