/** Writes one `validation_results` row for a draft, matching 20260903120005_generation_and_validation.sql. */
export async function persistValidationResult(pool, generationDraftId, outcome) {
    const result = await pool.query(`insert into validation_results (generation_draft_id, passed, errors)
     values ($1, $2, $3::jsonb)
     returning id`, [generationDraftId, outcome.passed, JSON.stringify(outcome.errors)]);
    return result.rows[0].id;
}
