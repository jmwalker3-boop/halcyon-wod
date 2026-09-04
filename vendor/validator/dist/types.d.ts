export type Modality = 'M' | 'G' | 'W';
export type Pattern = 'squat' | 'hinge' | 'lunge' | 'unilateral-leg' | 'push-vertical' | 'push-horizontal' | 'pull-vertical' | 'pull-horizontal' | 'core' | 'carry' | 'jump' | 'monostructural-cardio';
export type DayType = 'Training' | 'Skill' | 'Recovery';
export type SegmentType = 'warmup' | 'skill' | 'strength' | 'metcon' | 'accessory';
export type Placement = 'pre' | 'post';
export type TieType = 'supports_movement' | 'lighter_variant';
export type BlockType = 'benchmark' | 'short' | 'standard';
export type TemplateDirection = 'ascending' | 'descending';
/** One movement as it appears in a draft, referenced by name (see file header). */
export interface DraftMovement {
    /** Must match a `movements.canonical_name` or a `movement_aliases.alias`. */
    name: string;
    /** Free-text prescription as the athlete will read it, e.g. "5-5-5-5-5" or "12 reps". */
    reps?: string;
    /** Present only for loaded movements; absent for bodyweight/monostructural work. */
    prescribed_load?: {
        value: number;
        unit: 'lb' | 'kg';
        /**
         * How the load was derived. Rule 3 only accepts 'recent_1rm_pct' as
         * fully compliant; 'fixed' and 'bodyweight' are fine but exempt from
         * Rule 3 (there's no rep-max to be stale against); a load with no
         * basis at all fails Rule 3 outright -- see rules/strengthRecentRepMax.ts.
         */
        basis: 'recent_1rm_pct' | 'fixed' | 'bodyweight';
        pct_of_1rm?: number;
    };
}
/** One segment of a draft, mirroring a `workout_segments` row plus its movements/ties inline. */
export interface DraftSegment {
    segment_type: SegmentType;
    /** Required and meaningful only for skill/strength (matches the DB check constraint). */
    placement?: Placement;
    order_index: number;
    movements: DraftMovement[];
    /**
     * MetCon-tie declarations this segment makes, if any -- Rule 6 reads
     * these. A skill/strength segment declares a tie *to* the metcon
     * segment in the same draft; the metcon segment itself carries none.
     */
    ties?: {
        tie_type: TieType;
        /** The metcon movement this segment supports, or is a lighter variant of. */
        movement_name: string;
        note?: string;
    }[];
}
export interface DraftSequence {
    segments: DraftSegment[];
}
export interface MovementInfo {
    id: string;
    canonical_name: string;
    modality: Modality;
    patterns: Pattern[];
}
/** A trailing day used by Rule 2 (2-of-3) -- one calendar day's already-committed movement patterns. */
export interface TrailingDay {
    date: string;
    day_type: DayType;
    patterns: Pattern[];
}
/** One prior MetCon-tie occurrence, used by Rule 6 to compute the year-to-date split. */
export interface PriorTie {
    date: string;
    tie_type: TieType;
    segment_type: 'skill' | 'strength';
    placement: Placement;
}
export interface RepMaxRecord {
    movement_name: string;
    value: number;
    achieved_at: string;
}
export interface TrainingBlockInfo {
    block_number: number;
    block_type: BlockType;
    lead_modality: Modality | null;
    template_direction: TemplateDirection | null;
    /**
     * Every on-day slot already scheduled in this block, in `slot_in_block`
     * order (matches `calendar_slots.slot_in_block`). Rule 5 uses just the
     * dates/count; Rule 7 uses `target_modalities` to check the single ->
     * double -> triple build and which modality leads.
     */
    on_days: {
        date: string;
        slot_in_block: number;
        target_modalities: Modality[];
    }[];
}
export interface ValidationContext {
    calendar_slot: {
        id: string;
        date: string;
        day_type: DayType;
        target_modalities: Modality[];
        slot_in_block: number | null;
        /**
         * Set by a coach ahead of time to pre-authorize a deliberate doctrine
         * deviation for this slot. Read by Rule 4 -- see
         * rules/exceptionsNeedReason.ts for the excuse mechanism this drives.
         */
        override_reason: string | null;
    };
    training_block: TrainingBlockInfo;
    /** Trailing days strictly before calendar_slot.date, most recent first, enough to cover the widest window any rule needs (>= 3). */
    trailing_days: TrailingDay[];
    /**
     * Every OTHER day in the current training_block (any day_type -- on-days
     * and the block's skill/recovery day) that already has a committed
     * workout, with the literal movement names used that day. Scoped to this
     * one block only -- deliberately not the rolling program-wide
     * trailing_days window above, which spans the whole program_cycle and
     * tracks patterns, not movement identity. Rule 8 is the only rule that
     * reads this.
     */
    block_movements: {
        date: string;
        movement_names: string[];
    }[];
    /** Prior MetCon ties in the current 365-day window, for Rule 6. */
    prior_ties: PriorTie[];
    /** This athlete's/program's most recent rep-max records, for Rule 3. Callers filter to the recency window; the rule re-checks it anyway (see rule for why). */
    rep_maxes: RepMaxRecord[];
    /** The full movement taxonomy needed to resolve draft movement names -- canonical names + all aliases, flattened to one name->info map by the context loader. */
    movements_by_name: Map<string, MovementInfo>;
    /** Wall-clock "today" the recency windows (Rule 3's 90 days, Rule 6's 365) are measured against -- normally calendar_slot.date. */
    as_of_date: string;
}
export interface RuleViolation {
    rule: string;
    message: string;
    /** Present when Rule 4 found a coach-stated override_reason on the slot and excused this violation rather than blocking on it. */
    excused?: boolean;
}
export interface RuleConfig {
    [ruleName: string]: Record<string, unknown> & {
        active?: boolean;
    };
}
export interface ValidationOutcome {
    passed: boolean;
    /** Every violation found, excused or not -- this is the full audit trail for `validation_results.errors`. */
    errors: RuleViolation[];
}
