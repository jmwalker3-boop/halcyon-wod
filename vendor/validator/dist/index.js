// Black Box Method -- doctrine validator engine.
//
// This is the mechanical piece that's identical whether a draft was
// assembled by a pure deterministic generator or drafted by an LLM (see
// generation_demo.py for the original proof-of-concept this replaces) --
// every draft, regardless of how it was produced, clears the same checks
// before a subscriber ever sees it.
//
// Usage: build a ValidationContext (see context.ts for the Postgres-backed
// loader), then:
//
//   const outcome = runValidator(draftSequence, context, config);
//   // outcome.passed, outcome.errors -> write straight to validation_results
//
// The eight doctrine rules map to seven content-checking functions plus one
// policy wrapper (Rule 4, see rules/exceptionsNeedReason.ts for why it's
// structured differently from the rest). Rules 5 (corrected) and 8 were
// added/fixed 2026-09-04, after the rest of this engine was built and
// verified -- see rules/benchmarkDayCadence.ts and
// rules/noMovementRepeatInBlock.ts for what changed and why.
import { DEFAULT_RULE_CONFIG, mergeRuleConfig } from './ruleConfig.js';
import { checkCompoundFirst } from './rules/compoundFirst.js';
import { checkTwoOfThree } from './rules/twoOfThree.js';
import { checkStrengthRecentRepMax } from './rules/strengthRecentRepMax.js';
import { checkBenchmarkDayCadence } from './rules/benchmarkDayCadence.js';
import { checkMetconTiedVariance } from './rules/metconTiedVariance.js';
import { checkMgwBlockTemplate } from './rules/mgwBlockTemplate.js';
import { checkNoMovementRepeatInBlock } from './rules/noMovementRepeatInBlock.js';
import { applyExceptionPolicy } from './rules/exceptionsNeedReason.js';
import { computeBannedPatterns } from './bannedPatterns.js';
export * from './types.js';
export { DEFAULT_RULE_CONFIG, mergeRuleConfig, computeBannedPatterns };
/**
 * Runs Rules 1, 2, 3, 5, 6, 7, 8 against a draft, then applies Rule 4's
 * override-reason policy to whatever they found. `config` defaults to the
 * values seeded in 20260903120008_seed_rules.sql; pass the live `rules`
 * table contents (merged via `mergeRuleConfig`) to respect in-app tuning.
 */
export function runValidator(sequence, context, config = DEFAULT_RULE_CONFIG) {
    const contentViolations = [
        ...checkCompoundFirst(sequence, context, config),
        ...checkTwoOfThree(sequence, context, config),
        ...checkStrengthRecentRepMax(sequence, context, config),
        ...checkBenchmarkDayCadence(sequence, context, config),
        ...checkMetconTiedVariance(sequence, context, config),
        ...checkMgwBlockTemplate(sequence, context, config),
        ...checkNoMovementRepeatInBlock(sequence, context, config),
    ];
    const { errors, passed } = applyExceptionPolicy(contentViolations, context.calendar_slot.override_reason);
    return { passed, errors };
}
