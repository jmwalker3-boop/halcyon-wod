// The movement taxonomy has "bar" and "pull-up bar" as two names for the same
// physical equipment (flagged in 20260903160000_profile_equipment.sql's header
// comment when the equipment selector was built, not fixed at the data layer
// since it would mean touching every movement row that uses either spelling).
// Handled here instead: every equipment_tag this package sees -- both what an
// athlete says they own and what a movement says it requires -- goes through
// this normalization first, so an athlete who logged "pull-up bar" isn't
// falsely flagged as missing a movement that calls for "bar" (or vice versa).
//
// If the taxonomy ever gets normalized at the source, this map becomes a
// no-op and can be deleted; nothing else in this package needs to change.
const EQUIPMENT_ALIASES = {
    'pull-up bar': 'bar',
};
export function normalizeEquipmentTag(tag) {
    return EQUIPMENT_ALIASES[tag] ?? tag;
}
