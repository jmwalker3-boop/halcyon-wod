import { checkEquipmentGap } from './equipmentGap.js';
import { needsLoadRounding, roundToOwnedLoad } from './loadRounding.js';
import { normalizeEquipmentTag } from './equipmentAliases.js';
import { convertDistance } from './machineConversion.js';
function ok(prescribedName, extra = {}) {
    return {
        prescribedName,
        movementName: prescribedName,
        displayName: prescribedName,
        scaledBecause: null,
        status: 'ok',
        missingEquipment: [],
        load: null,
        machineScaleOptions: null,
        ...extra,
    };
}
// Maps profile_equipment/movements.equipment tags to the CAP chart's own
// machine columns. Ski Erg and Row are deliberately the same column here --
// that's the source chart's own modeling choice (see machineConversion.ts),
// not a simplification added here.
const EQUIPMENT_TAG_TO_CAP_MACHINE = {
    rower: 'row_ski',
    'ski erg': 'row_ski',
    'bike erg': 'c2_bike',
    bike: 'assault_echo_bike',
};
// The movements table's own canonical_name for each real, ownable machine
// (confirmed live, 2026-09-06) -- keyed by equipment TAG, not by CapMachine
// bucket. That distinction matters: Row and Ski Erg share one CapMachine
// bucket ('row_ski') because the CAP chart treats their distances as
// equivalent, but they're still two different physical machines an athlete
// might separately own -- collapsing to one display name per bucket would
// silently drop "Row" as a suggestion whenever the gap was Ski Erg (found
// while writing this feature's tests, 2026-09-06: owning only a rower and
// missing a Ski Erg produced just "Run", because the bucket-level dedup
// treated row_ski-via-rower as identical to row_ski-via-ski-erg and
// stripped the whole bucket).
const CAP_TAG_DISPLAY_NAME = {
    rower: 'Row',
    'ski erg': 'Ski Erg',
    'bike erg': 'Bike Erg',
    bike: 'Bike (Echo/Assault)',
};
// Only called once a gap is confirmed unresolved by the existing
// skill/equipment-substitute passes -- this is a third, narrower pass that
// applies only when the gap is specifically a monostructural machine and
// the workout recorded a distance. Deliberately returns every owned
// alternative rather than picking one: an athlete who owns both a rower and
// an assault bike should see both options, not have this silently choose
// for them (same "human makes the call" posture as needs_substitution).
function computeMachineScaleOptions(equipment, distanceM, ownedTags) {
    const fromTag = equipment.map(normalizeEquipmentTag).find((tag) => tag in EQUIPMENT_TAG_TO_CAP_MACHINE);
    if (!fromTag)
        return null;
    const fromMachine = EQUIPMENT_TAG_TO_CAP_MACHINE[fromTag];
    const options = [];
    const seen = new Set();
    const addOption = (toMachine, displayName) => {
        if (seen.has(displayName))
            return;
        seen.add(displayName);
        options.push({ machine: displayName, ...convertDistance(distanceM, fromMachine, toMachine) });
    };
    // Run always qualifies -- its equipment tag is "none", so it's never
    // something an athlete needs to have separately recorded as owned.
    addOption('run', 'Run');
    for (const tag of ownedTags) {
        const normalized = normalizeEquipmentTag(tag);
        if (normalized === fromTag)
            continue; // can't actually happen (the gap check already means this isn't owned), guarded anyway
        const machine = EQUIPMENT_TAG_TO_CAP_MACHINE[normalized];
        if (machine)
            addOption(machine, CAP_TAG_DISPLAY_NAME[normalized]);
    }
    return options;
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
        const machineScaleOptions = movement.prescribedDistanceM != null
            ? computeMachineScaleOptions(current.equipment, movement.prescribedDistanceM, owned.tags)
            : null;
        return {
            prescribedName,
            movementName: prescribedName,
            displayName: current.name,
            scaledBecause: null,
            status: 'needs_substitution',
            missingEquipment: gap.missingEquipment,
            load: null,
            machineScaleOptions,
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
            machineScaleOptions: null,
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
            machineScaleOptions: null,
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
