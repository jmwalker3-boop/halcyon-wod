import { checkEquipmentGap } from './equipmentGap.js';
import { needsLoadRounding, roundToOwnedLoad } from './loadRounding.js';
import { normalizeEquipmentTag } from './equipmentAliases.js';
function ok(prescribedName, extra = {}) {
    return {
        prescribedName,
        movementName: prescribedName,
        displayName: prescribedName,
        scaledBecause: null,
        status: 'ok',
        missingEquipment: [],
        load: null,
        ...extra,
    };
}
/**
 * Resolves one movement from the coach's base workout to one athlete's actual Rx.
 *
 * Two independent scaling passes, in order (see the 20260904120000 migration's
 * header for the reasoning): first skill level (gymnastics-only, via
 * rx.skillSubstitutes -- movement_scales), then equipment (via
 * rx.equipmentSubstitutes -- movement_equipment_substitutes). Either pass is a
 * no-op if its data isn't supplied (both are optional), so existing 2-argument
 * call sites resolve exactly as before -- only 'ok' | 'rounded' | 'needs_substitution'
 * | 'needs_load_data' can come back without an RxContext.
 *
 * The equipment pass DOES chase a chain of substitutes (added 2026-09-05, per
 * John's request for Ring Push-up -> Plate Push-up -> Push-up): if the first
 * substitute still has its own gap, and THAT movement has its own row in
 * movement_equipment_substitutes, the chain keeps walking until something
 * resolves, a movement repeats (cycle guard), or MAX_SUBSTITUTE_HOPS is hit.
 * Still does NOT invent a swap when no data source has one on file -- a gap
 * with no resolvable answer (chain exhausted or absent) comes back as
 * `needs_substitution`, reporting the last movement actually tried.
 */
const MAX_SUBSTITUTE_HOPS = 5;
export function resolveMovementForAthlete(movement, owned, rx = {}) {
    const prescribedName = movement.name;
    let current = { name: movement.name, equipment: movement.equipment };
    let scaledBecause = null;
    // 1. Skill-level scaling (gymnastics only -- movement.skillCategory is only
    // ever set on movements the migration tagged with a skill_category).
    if (movement.skillCategory && rx.skillLevels) {
        const level = rx.skillLevels.get(movement.skillCategory) ?? 'rx';
        if (level !== 'rx') {
            const tiers = rx.skillSubstitutes?.get(current.name.toLowerCase());
            const swap = tiers?.[level];
            if (swap) {
                current = swap;
                scaledBecause = 'skill_level';
            }
        }
    }
    // 2. Equipment gap check, against whichever movement we're on after step 1.
    // Chases a chain of substitutes (see the function header) rather than
    // stopping after one hop -- e.g. Ring Push-up -> Plate Push-up -> Push-up,
    // so an athlete with neither rings nor plates still lands on plain Push-up.
    let gap = checkEquipmentGap(current.name, current.equipment, owned.tags);
    if (!gap.ok) {
        const seen = new Set([current.name.toLowerCase()]);
        for (let hops = 0; hops < MAX_SUBSTITUTE_HOPS; hops++) {
            const swap = rx.equipmentSubstitutes?.get(current.name.toLowerCase());
            if (!swap || seen.has(swap.name.toLowerCase()))
                break; // no data, or a cycle in the substitute chain
            seen.add(swap.name.toLowerCase());
            current = swap;
            scaledBecause = 'equipment';
            gap = checkEquipmentGap(current.name, current.equipment, owned.tags);
            if (gap.ok)
                break; // fully resolved -- the athlete has everything this link in the chain needs
        }
        if (!gap.ok) {
            // Chain exhausted (or never existed) without resolving -- report the
            // last movement actually tried (more useful than the original), but
            // this wasn't a real scale since nothing came back 'ok'.
            scaledBecause = null;
        }
    }
    if (!gap.ok) {
        return {
            prescribedName,
            movementName: prescribedName,
            displayName: current.name,
            scaledBecause: null,
            status: 'needs_substitution',
            missingEquipment: gap.missingEquipment,
            load: null,
        };
    }
    if (scaledBecause) {
        // A skill-level or equipment swap fully resolved -- gymnastics-family
        // swaps in movement_scales don't carry a prescribed load to round, so
        // load rounding is skipped on this path (kept simple; revisit if a
        // loaded movement ever needs both an equipment swap and rounding).
        return {
            prescribedName,
            movementName: prescribedName,
            displayName: current.name,
            scaledBecause,
            status: 'scaled',
            missingEquipment: [],
            load: movement.prescribedLoad ?? null,
        };
    }
    if (!movement.prescribedLoad) {
        return ok(prescribedName);
    }
    const loadBearingTag = current.equipment.find(needsLoadRounding);
    if (!loadBearingTag) {
        // Equipment class doesn't carry discrete owned weights (e.g. a barbell lift,
        // where "plate" is what actually varies -- see the plate case below) or the
        // movement's own equipment list doesn't include a load-bearing class at all.
        return ok(prescribedName, { load: movement.prescribedLoad });
    }
    const ownedLoadsForTag = owned.loadsByTag.get(normalizeEquipmentTag(loadBearingTag)) ?? [];
    const rounded = roundToOwnedLoad(movement.prescribedLoad.value, movement.prescribedLoad.unit, ownedLoadsForTag);
    if (rounded === null) {
        return {
            prescribedName,
            movementName: prescribedName,
            displayName: current.name,
            scaledBecause: null,
            status: 'needs_load_data',
            missingEquipment: [],
            load: null,
        };
    }
    return ok(prescribedName, {
        status: rounded === movement.prescribedLoad.value ? 'ok' : 'rounded',
        load: { value: rounded, unit: movement.prescribedLoad.unit },
    });
}
export function resolveWorkoutForAthlete(movements, owned, rx = {}) {
    return movements.map((m) => resolveMovementForAthlete(m, owned, rx));
}
