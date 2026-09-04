export type WeightUnit = 'lb' | 'kg';
/** Matches the DB enum of the same name (20260904120000 migration). 'rx' means
 *  no scaling -- the athlete does the movement as the coach wrote it. */
export type AthleteSkillLevel = 'rx' | 'intermediate' | 'beginner';
/** Matches skill_category_enum (20260904120000 migration) -- the gymnastics
 *  skill families an athlete can set a level for. */
export type SkillCategory = 'pull_up_bar' | 'rings' | 'handstand' | 'hanging_core' | 'rope_climb' | 'pistol';
/** A named movement plus the equipment it requires -- used both for a
 *  workout's own movements and for a substitute target (movement_scales'
 *  scale_movement_id, or movement_equipment_substitutes' substitute_id). */
export interface MovementRef {
    name: string;
    equipment: string[];
}
/** One athlete's equipment inventory, already alias-normalized (see equipmentAliases.ts). */
export interface OwnedEquipment {
    /** Equipment classes the athlete has at all -- "I have a pull-up bar." */
    tags: Set<string>;
    /** Specific weights owned, for the equipment classes where a discrete load matters
     *  (dumbbell, kettlebell, plate, band, sandbag, med ball, wall ball) -- keyed by
     *  normalized equipment_tag. */
    loadsByTag: Map<string, OwnedLoad[]>;
}
export interface OwnedLoad {
    value: number;
    unit: WeightUnit;
    quantity: number;
}
/** A single movement as written in the coach's base workout, before resolving it to
 *  any one athlete. `equipment` matches movements.equipment exactly. `skillCategory`
 *  is set only for movements that carry one in the movements table (gymnastics
 *  skill families -- see the 20260904120000 migration); leave it undefined for
 *  everything else and no skill-level scaling is attempted. */
export interface MovementToResolve {
    name: string;
    equipment: string[];
    skillCategory?: SkillCategory;
    prescribedLoad?: {
        value: number;
        unit: WeightUnit;
    };
}
/** Everything the resolver needs to attempt automatic scaling, beyond raw
 *  equipment ownership -- all optional and all default to "do nothing", so
 *  existing 2-argument call sites keep working unchanged.
 *
 *  skillSubstitutes and equipmentSubstitutes are keyed by the LOWERCASED
 *  canonical movement name (movements.canonical_name.toLowerCase()) they
 *  apply to, mirroring movement_scales and movement_equipment_substitutes
 *  respectively. */
export interface RxContext {
    /** The athlete's own profile_skill_levels, one level per category they've set.
     *  A category with no entry (or not present in this map) is treated as 'rx'. */
    skillLevels?: Map<SkillCategory, AthleteSkillLevel>;
    skillSubstitutes?: Map<string, Partial<Record<'intermediate' | 'beginner', MovementRef>>>;
    equipmentSubstitutes?: Map<string, MovementRef>;
}
export interface EquipmentGapResult {
    movementName: string;
    requiredEquipment: string[];
    /** Equipment the movement calls for that this athlete doesn't have (alias-resolved,
     *  "bodyweight" never counted as missing). Empty means no gap. */
    missingEquipment: string[];
    ok: boolean;
}
export type ResolvedMovementStatus = 
/** Athlete has everything the movement needs, at the exact prescribed load (or no load to round). */
'ok'
/** Athlete has everything the movement needs, but the load was rounded to what they own. */
 | 'rounded'
/** The movement shown is NOT what the coach wrote -- it was swapped automatically because
 *  of the athlete's skill level or missing equipment, and the swap fully resolves (the
 *  athlete has everything the substitute needs). See scaledBecause and displayName/displayEquipment. */
 | 'scaled'
/** Athlete is missing required equipment and no substitute was found (or the substitute on
 *  file has its own unresolved gap) -- this movement needs a coach-reviewed swap, which this
 *  package deliberately does not guess beyond one lookup (see index.ts header). */
 | 'needs_substitution'
/** Athlete has the equipment class but hasn't recorded any owned loads for it, so no load
 *  could be resolved -- distinct from needs_substitution: the gap is data, not equipment. */
 | 'needs_load_data';
export interface ResolvedMovement {
    /** The movement name exactly as the coach wrote it -- always present, so the UI can show
     *  "Rx: X" even when displayName differs. */
    prescribedName: string;
    /** @deprecated use prescribedName -- kept so existing 2-arg call sites reading movementName
     *  don't silently break. Always equal to prescribedName. */
    movementName: string;
    /** What the athlete should actually do -- equal to prescribedName unless status is 'scaled',
     *  in which case this is the swapped-in movement. */
    displayName: string;
    /** Why displayName differs from prescribedName, if it does. Null for every status except 'scaled'. */
    scaledBecause: 'skill_level' | 'equipment' | null;
    status: ResolvedMovementStatus;
    missingEquipment: string[];
    load: {
        value: number;
        unit: WeightUnit;
    } | null;
}
