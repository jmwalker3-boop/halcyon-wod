import type { Pool } from 'pg';
import type { ValidationOutcome } from './types.js';
/** Writes one `validation_results` row for a draft, matching 20260903120005_generation_and_validation.sql. */
export declare function persistValidationResult(pool: Pool, generationDraftId: string, outcome: ValidationOutcome): Promise<string>;
