import type { DraftSequence, RuleConfig, ValidationContext, ValidationOutcome } from './types.js';
import { DEFAULT_RULE_CONFIG, mergeRuleConfig } from './ruleConfig.js';
import { computeBannedPatterns } from './bannedPatterns.js';
export * from './types.js';
export { DEFAULT_RULE_CONFIG, mergeRuleConfig, computeBannedPatterns };
/**
 * Runs Rules 1, 2, 3, 5, 6, 7, 8 against a draft, then applies Rule 4's
 * override-reason policy to whatever they found. `config` defaults to the
 * values seeded in 20260903120008_seed_rules.sql; pass the live `rules`
 * table contents (merged via `mergeRuleConfig`) to respect in-app tuning.
 */
export declare function runValidator(sequence: DraftSequence, context: ValidationContext, config?: RuleConfig): ValidationOutcome;
