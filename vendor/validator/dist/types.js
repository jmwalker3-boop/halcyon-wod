// Black Box Method -- validator engine types
//
// This file defines two things that don't exist as SQL: the shape of
// `generation_drafts.draft_sequence` (the structured half of a draft, which
// `draft_text` is the human-readable rendering of), and the in-memory
// `ValidationContext` the rule functions run against.
//
// draft_sequence is intentionally shaped like a staging-area mirror of the
// real `workout_segments` / `workout_movements` / `segment_ties` tables it
// gets materialized into once validation passes -- same segment/placement/
// tie vocabulary, same order_index convention -- so "commit an accepted
// draft" is a straight structural copy, not a re-interpretation. The one
// deliberate difference: movements are referenced by name (canonical_name
// or a known alias), not by movement_id. The drafting model works from
// movement names (that's what's in its prompt context), so resolving
// name -> movement row is the validator's job, not the model's -- and
// unresolvable names are themselves a validation failure worth surfacing
// clearly, not a silent crash.
export {};
