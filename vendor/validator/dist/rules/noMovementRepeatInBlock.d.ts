import type { DraftSequence, RuleConfig, RuleViolation, ValidationContext } from '../types.js';
export declare function checkNoMovementRepeatInBlock(sequence: DraftSequence, context: ValidationContext, config: RuleConfig): RuleViolation[];
