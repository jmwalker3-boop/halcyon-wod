// Black Box Method -- equipment/scaling resolution engine.
//
// This is the piece the "rolling calendar" model actually needs (confirmed
// with John, 2026-09-03): every enrolled athlete trains off the same
// coach-written base workout on a given day, but the specific Rx varies per
// athlete -- movement swaps when equipment is missing, movement swaps when a
// gymnastics skill isn't there yet, load rounding when it isn't the exact
// weight prescribed. This package resolves one base workout to one athlete's
// actual Rx; it does not write or generate workout content (that stays
// coach-authored, see the architecture notes).
//
// Two scaling passes, both optional (pass an RxContext to opt in -- omitting
// it resolves exactly as the original equipment-only version did):
//   1. Skill level (gymnastics only, per-category -- profile_skill_levels,
//      20260904120000 migration): swaps via movement_scales, which already
//      has an intermediate/beginner substitute for every movement.
//   2. Equipment substitution (movement_equipment_substitutes, same
//      migration): a first-authored-draft, one generic substitute per
//      movement, for the cases with no equipment listed as an alternative
//      already. Deliberately does NOT chase a substitute-of-a-substitute or
//      invent a swap when neither data source has one on file -- a gap with
//      no resolvable answer comes back as `needs_substitution` for a human
//      to make that call, never a guessed swap.
//
// Usage:
//   const owned = await fetchOwnedEquipment(pool, profileId);
//   const resolved = resolveWorkoutForAthlete(todaysMovements, owned, rxContext);
//   // resolved[i].status is 'ok' | 'rounded' | 'scaled' | 'needs_substitution' | 'needs_load_data'
//   // resolved[i].displayName is what the athlete should actually do; prescribedName is what the coach wrote.
export * from './types.js';
export { normalizeEquipmentTag } from './equipmentAliases.js';
export { checkEquipmentGap } from './equipmentGap.js';
export { needsLoadRounding, roundToOwnedLoad } from './loadRounding.js';
export { resolveMovementForAthlete, resolveWorkoutForAthlete } from './resolve.js';
