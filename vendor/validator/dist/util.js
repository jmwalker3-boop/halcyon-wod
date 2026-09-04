/** Case-insensitive lookup by canonical name or alias -- draft text is hand/model-written, not guaranteed exact-case. */
export function resolveMovement(context, name) {
    return context.movements_by_name.get(name.trim().toLowerCase());
}
export function allMovements(sequence) {
    return sequence.segments.flatMap((segment) => segment.movements.map((m) => ({ segment, name: m.name })));
}
export function segmentsOfType(sequence, type) {
    return sequence.segments.filter((s) => s.segment_type === type).sort((a, b) => a.order_index - b.order_index);
}
/** Days (inclusive of the given date) counting back `windowDays` calendar days -- what "trailing N-day window" means throughout the doctrine rules. */
export function daysBetween(a, b) {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((new Date(a).getTime() - new Date(b).getTime()) / msPerDay);
}
