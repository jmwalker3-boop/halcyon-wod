import type { DraftSequence, RuleConfig, RuleViolation, ValidationContext } from '../types.js';
export declare function checkTwoOfThree(sequence: DraftSequence, context: ValidationContext, config: RuleConfig): RuleViolation[];
