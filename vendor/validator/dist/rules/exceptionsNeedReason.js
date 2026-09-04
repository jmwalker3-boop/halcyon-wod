// Rule 4 -- Exceptions Need a Logical Reason: any validator override
// requires a non-null stated reason.
//
// Design decision (flagged, worth confirming with John): this isn't a
// content check like the other six -- there's nothing about a draft in
// isolation that Rule 4 inspects. Read plainly, it's a policy about what
// happens *when the other six rules fail*: a coach can pre-authorize a
// deliberate doctrine deviation for a specific calendar slot by setting
// `calendar_slots.override_reason` (that column already exists precisely
// for this -- see 20260903120004_programming_and_calendar.sql), and this
// rule is what decides whether a violation is a hard block or an excused,
// logged exception.
//
// So this isn't run alongside the other six inside the per-rule loop --
// it's applied once, after them, in index.ts's runValidator: if the other
// rules produced zero violations, Rule 4 has nothing to do and never
// appears in the output at all. If they produced violations and
// override_reason is set (non-empty), every one of those violations is
// marked `excused: true` and the overall result passes -- the reason
// itself is trusted as the "logical reason" the doctrine requires, not
// further validated for content (that's a coach's judgment call, not a
// mechanical one). If they produced violations and override_reason is
// empty/null, Rule 4 itself adds a blocking violation and the draft fails
// -- the exact enforcement the rule's name promises: no silent, unexplained
// exceptions.
const RULE_NAME = 'Exceptions Need a Logical Reason';
/**
 * Applies the override-reason policy to violations already found by the
 * other six rules. Returns the full violation list (with `excused` set
 * where applicable) plus whether the draft as a whole passes.
 */
export function applyExceptionPolicy(otherViolations, overrideReason) {
    if (otherViolations.length === 0) {
        return { errors: [], passed: true };
    }
    const hasReason = !!overrideReason && overrideReason.trim().length > 0;
    if (hasReason) {
        return {
            errors: otherViolations.map((v) => ({ ...v, excused: true })),
            passed: true,
        };
    }
    return {
        errors: [
            ...otherViolations,
            {
                rule: RULE_NAME,
                message: `${otherViolations.length} doctrine violation(s) found and no override_reason is set on this calendar slot -- a coach must state a reason to allow them through.`,
            },
        ],
        passed: false,
    };
}
