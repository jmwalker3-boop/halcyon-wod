import type { DraftSequence, RuleConfig, RuleViolation, ValidationContext } from '../types.js';
export declare const DEFAULT_MIN_SAMPLE = 10;
export declare const DEFAULT_TOLERANCE_PCT = 15;
export declare function checkMetconTiedVariance(sequence: DraftSequence, context: ValidationContext, config: RuleConfig): RuleViolation[];
