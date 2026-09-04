import type { Pool } from 'pg';
import type { ValidationContext } from './types.js';
export interface FetchContextOptions {
    /** Overrides the default (program owner) profile whose rep-max records back Rule 3. */
    profileId?: string;
    /** How far back to pull trailing-day pattern history; must cover the widest rule window (2-of-3's default is 3 days) with margin. Default 14. */
    trailingDaysLookback?: number;
    /** How far back to pull prior MetCon ties for Rule 6. Default matches the rule's own 365-day window. */
    tieLookbackDays?: number;
}
export declare function fetchContext(pool: Pool, calendarSlotId: string, opts?: FetchContextOptions): Promise<ValidationContext>;
