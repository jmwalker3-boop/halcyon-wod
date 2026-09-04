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
 * Deliberately does NOT chase a substitute-of-a-substitute, and does NOT
 * invent a swap when neither data source has one on file -- a gap with no
 * resolvable answer comes back as `needs_substitution` for a human to make
 * that call, same philosophy as the original version of this function.
 */
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
    let gap = checkEquipmentGap(current.name, current.equipment, owned.tags);
    if (!gap.ok) {
        const swap = rx.equipmentSubstitutes?.get(current.name.toLowerCase());
        if (swap) {
            const swapGap = checkEquipmentGap(swap.name, swap.equipment, owned.tags);
            if (swapGap.ok) {
                // Fully resolved -- the athlete has everything the substitute needs.
                current = swap;
                scaledBecause = 'equipment';
                gap = swapGap;
            }
            else {
                // The substitute on file has its own gap -- still not resolvable
                // automatically, but report the substitute's gap (more useful than
                // the original's) rather than pretending nothing was tried.
                gap = swapGap;
                current = swap;
            }
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
