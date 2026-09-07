-- Adds the scaling tier (Rx / intermediate / beginner) an athlete's score
-- was logged under, so the leaderboard (mockup screen 2c, "the board") can
-- filter by silo and show a per-entry tier badge -- neither is possible
-- today since workout_logs never recorded which tier the athlete was on
-- at logging time.
--
-- NOTE for whoever applies this: this checkout of the repo has no
-- supabase/migrations directory at all (every prior migration is only
-- known from code comments referencing it by name/timestamp, e.g.
-- 20260904120000, 20260907150000_admin_unenroll.sql), so this file's
-- timestamp, the athlete_skill_level enum name, and the assumption that
-- profiles/workout_logs look exactly like lib/db/types.ts describes are
-- all best-effort inferred from those comments, not verified against the
-- live schema. Confirm the enum name and column set against the actual
-- project before applying.
--
-- Default 'rx' on backfill is a known approximation for every score
-- logged before this column existed -- there's no way to reconstruct what
-- tier a past score was actually logged under, so old rows will
-- under-report scaled/beginner entries as Rx on the board until they age
-- out of whatever window the UI shows.
alter table workout_logs
  add column if not exists result_tier athlete_skill_level not null default 'rx';

comment on column workout_logs.result_tier is
  'Scaling tier the athlete was on for this workout''s skill categories when they logged this score (rx/intermediate/beginner) -- set by the client at log time (see components/ScoreForm.tsx), not derived after the fact.';
