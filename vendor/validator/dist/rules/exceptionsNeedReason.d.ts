import type { RuleViolation } from '../types.js';
/**
 * Applies the override-reason policy to violations already found by the
 * other six rules. Returns the full violation list (with `excused` set
 * where applicable) plus whether the draft as a whole passes.
 */
export declare function applyExceptionPolicy(otherViolations: RuleViolation[], overrideReason: string | null): {
    errors: RuleViolation[];
    passed: boolean;
};
