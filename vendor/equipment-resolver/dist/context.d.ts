import type { Pool } from 'pg';
import type { OwnedEquipment } from './types.js';
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
export declare function fetchOwnedEquipment(pool: Pool, profileId: string): Promise<OwnedEquipment>;
