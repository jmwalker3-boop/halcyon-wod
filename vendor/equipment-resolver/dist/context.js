import { normalizeEquipmentTag } from './equipmentAliases.js';
/**
 * Loads one athlete's equipment inventory from Postgres, matching
 * 20260903160000_profile_equipment.sql. Uses a direct pg.Pool (not the
 * anon-key Supabase client) the same way the validator's context.ts does --
 * this is meant to run server-side, ahead of a page render or a batch job,
 * not as a client-scoped query.
 *
 * Note: profile_equipment_loads.load_value is `numeric`, which node-postgres
 * returns as a string by default (it doesn't assume numeric always fits in a
 * JS number without precision loss) -- explicitly Number()'d below rather
 * than trusting the driver, the same category of gotcha the validator's
 * context.ts hit with enum arrays.
 */
export async function fetchOwnedEquipment(pool, profileId) {
    const tagsResult = await pool.query(`select equipment_tag from profile_equipment where profile_id = $1`, [profileId]);
    const loadsResult = await pool.query(`select equipment_tag, load_value, unit, quantity from profile_equipment_loads where profile_id = $1`, [profileId]);
    const tags = new Set(tagsResult.rows.map((r) => normalizeEquipmentTag(r.equipment_tag)));
    const loadsByTag = new Map();
    for (const row of loadsResult.rows) {
        const tag = normalizeEquipmentTag(row.equipment_tag);
        const list = loadsByTag.get(tag) ?? [];
        list.push({ value: Number(row.load_value), unit: row.unit, quantity: row.quantity });
        loadsByTag.set(tag, list);
    }
    return { tags, loadsByTag };
}
