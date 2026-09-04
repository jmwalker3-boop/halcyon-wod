// Postgres-backed ValidationContext loader.
//
// Written against `pg` directly (raw SQL, no ORM) so it runs identically
// against the local verification database used throughout this project and
// against Supabase's connection-pooled Postgres in production -- swapping
// this for a supabase-js-based loader later is a drop-in change, since
// nothing here depends on anything Supabase-specific (RLS is irrelevant --
// this always runs with the service_role/backend connection, same as the
// generation engine and Stripe webhook handler already do).
//
// Gotcha worth keeping (caught by the integration smoke test, not by
// inspection): every array-typed column here is cast to `::text[]` in SQL.
// node-postgres only auto-parses arrays of built-in types by OID; an array
// of a custom enum (pattern_enum[], modality_enum[]) comes back as a raw
// "{a,b,c}" string, not a JS array, unless it's cast to a real text[] first
// -- which changes the column's actual OID to the built-in one pg knows
// how to decode. Drop a cast here and every rule silently gets string
// garbage instead of an array to iterate.
//
// Design decision (flagged, see rules/strengthRecentRepMax.ts's header for
// the fuller reasoning): generation happens once per calendar_slot, shared
// by every athlete enrolled in that program -- not once per athlete. But
// Rule 3 is about "the athlete's" recent rep max, which only exists
// per-profile. Rather than guess at per-athlete personalization happening
// at generation time (it doesn't fit the schema: workouts/calendar_slots
// carry no profile_id), this loader defaults to the *program owner's* rep
// maxes as the reference used to validate that a 1RM-based load claim is
// backed by *some* recent record for that movement -- reasonable for the
// common self-programmed/solo-coach case, and overridable by passing an
// explicit `profileId` for a 1-on-1 coaching setup where that's wrong.
// Worth confirming with John once real athlete-personalization (the
// equipment selector's sibling problem) gets designed.
export async function fetchContext(pool, calendarSlotId, opts = {}) {
    const trailingDaysLookback = opts.trailingDaysLookback ?? 14;
    const tieLookbackDays = opts.tieLookbackDays ?? 365;
    const slotResult = await pool.query(`select id, date::text, day_type, target_modalities::text[] as target_modalities, slot_in_block, override_reason,
            training_block_id, program_cycle_id
       from calendar_slots
      where id = $1`, [calendarSlotId]);
    const slot = slotResult.rows[0];
    if (!slot)
        throw new Error(`calendar_slots row not found for id=${calendarSlotId}`);
    if (!slot.training_block_id)
        throw new Error(`calendar_slots ${calendarSlotId} has no training_block_id -- can't validate Rules 5/7 without one`);
    const blockResult = await pool.query(`select block_number, block_type, lead_modality, template_direction
       from training_blocks where id = $1`, [slot.training_block_id]);
    const block = blockResult.rows[0];
    if (!block)
        throw new Error(`training_blocks row not found for id=${slot.training_block_id}`);
    const onDaysResult = await pool.query(`select date::text, slot_in_block, target_modalities::text[] as target_modalities
       from calendar_slots
      where training_block_id = $1 and slot_in_block is not null
      order by slot_in_block`, [slot.training_block_id]);
    // Trailing days: prior calendar_slots in the same program_cycle that already have a
    // committed workout, with the set of movement patterns tagged on that workout.
    const trailingResult = await pool.query(`select cs.date::text, cs.day_type,
            array_remove(array_agg(distinct mp.pattern), null)::text[] as patterns
       from calendar_slots cs
       join workouts w on w.id = cs.workout_id
       left join workout_movements wm on wm.workout_id = w.id
       left join movement_patterns mp on mp.movement_id = wm.movement_id
      where cs.program_cycle_id = $1
        and cs.date < $2::date
        and cs.date >= $2::date - $3::int
      group by cs.date, cs.day_type
      order by cs.date desc`, [slot.program_cycle_id, slot.date, trailingDaysLookback]);
    // Block-scoped movement history for Rule 8: every OTHER day in this same
    // training_block (any day_type -- deliberately not filtered to
    // slot_in_block is not null, since the block's skill/recovery day is in
    // scope too) that already has a committed workout, with the literal
    // movement names used that day. Distinct from the trailing_days query
    // above: that one spans the whole program_cycle by a day-count window and
    // tracks patterns; this one is bounded by the block itself and tracks
    // movement identity, which is what Rule 8 needs. "<>" rather than "<"
    // deliberately -- a block's days aren't always committed in date order
    // (e.g. re-generating an earlier day in an already-partially-committed
    // block), and Rule 8's "no repeat anywhere in the block" doesn't care
    // which direction in time the other occurrence falls.
    const blockMovementsResult = await pool.query(`select cs.date::text,
            array_remove(array_agg(distinct m.canonical_name), null)::text[] as movement_names
       from calendar_slots cs
       join workouts w on w.id = cs.workout_id
       left join workout_movements wm on wm.workout_id = w.id
       left join movements m on m.id = wm.movement_id
      where cs.training_block_id = $1
        and cs.date <> $2::date
      group by cs.date
      order by cs.date`, [slot.training_block_id, slot.date]);
    // Prior MetCon ties: segment_ties on committed workouts in this program cycle,
    // within the lookback window, resolved to (date, tie_type, source segment type, placement).
    const tiesResult = await pool.query(`select cs.date::text, st.tie_type, ws.segment_type, ws.placement
       from segment_ties st
       join workout_segments ws on ws.id = st.from_segment_id
       join workouts w on w.id = ws.workout_id
       join calendar_slots cs on cs.workout_id = w.id
      where cs.program_cycle_id = $1
        and cs.date < $2::date
        and cs.date >= $2::date - $3::int
        and ws.segment_type in ('skill', 'strength')
        and ws.placement is not null`, [slot.program_cycle_id, slot.date, tieLookbackDays]);
    let profileId = opts.profileId;
    if (!profileId) {
        const ownerResult = await pool.query(`select p.owner_id
         from programs p
         join program_cycles pc on pc.program_id = p.id
        where pc.id = $1`, [slot.program_cycle_id]);
        profileId = ownerResult.rows[0]?.owner_id;
    }
    const repMaxResult = profileId
        ? await pool.query(`select m.canonical_name as movement_name, pr.value, pr.achieved_at::text
           from personal_records pr
           join movements m on m.id = pr.movement_id
          where pr.profile_id = $1 and pr.record_type = '1RM'
          order by pr.achieved_at desc`, [profileId])
        : { rows: [] };
    const movementRows = await pool.query(`select m.canonical_name, ma.alias, m.modality,
            array_remove(array_agg(distinct mp.pattern), null)::text[] as patterns
       from movements m
       left join movement_aliases ma on ma.movement_id = m.id
       left join movement_patterns mp on mp.movement_id = m.id
      group by m.canonical_name, ma.alias, m.modality`);
    const movementsByCanonical = new Map();
    for (const row of movementRows.rows) {
        if (!movementsByCanonical.has(row.canonical_name)) {
            movementsByCanonical.set(row.canonical_name, {
                id: row.canonical_name, // id not needed by any rule today; canonical_name is stable and human-legible for messages/tests
                canonical_name: row.canonical_name,
                modality: row.modality,
                patterns: row.patterns ?? [],
            });
        }
    }
    const movementsByName = new Map();
    for (const row of movementRows.rows) {
        const info = movementsByCanonical.get(row.canonical_name);
        movementsByName.set(row.canonical_name.toLowerCase(), info);
        if (row.alias)
            movementsByName.set(row.alias.toLowerCase(), info);
    }
    return {
        calendar_slot: {
            id: slot.id,
            date: slot.date,
            day_type: slot.day_type,
            target_modalities: slot.target_modalities ?? [],
            slot_in_block: slot.slot_in_block,
            override_reason: slot.override_reason,
        },
        training_block: {
            block_number: block.block_number,
            block_type: block.block_type,
            lead_modality: block.lead_modality,
            template_direction: block.template_direction,
            on_days: onDaysResult.rows.map((r) => ({
                date: r.date,
                slot_in_block: r.slot_in_block,
                target_modalities: r.target_modalities ?? [],
            })),
        },
        trailing_days: trailingResult.rows.map((r) => ({ date: r.date, day_type: r.day_type, patterns: r.patterns ?? [] })),
        block_movements: blockMovementsResult.rows.map((r) => ({ date: r.date, movement_names: r.movement_names ?? [] })),
        prior_ties: tiesResult.rows,
        rep_maxes: repMaxResult.rows,
        movements_by_name: movementsByName,
        as_of_date: slot.date,
    };
}
