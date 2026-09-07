-- Adds the scaling tier (Rx / intermediate / beginner) an athlete's score
-- was logged under, so the leaderboard (mockup screen 2c, "the board") can
-- filter by silo and show a per-entry tier badge -- neither is possible
-- today since workout_logs never recorded which tier the athlete was on
-- at logging time.
--
-- Verified 2026-09-07 against the live project (mwktbgihukfmuswtphmm) via
-- the Supabase MCP connector: workout_logs has no result_tier column yet,
-- and the real enum name is athlete_skill_level_enum (not the bare
-- athlete_skill_level this file originally guessed from code comments,
-- before a live-schema check was possible in this environment).
--
-- Default 'rx' on backfill is a known approximation for every score
-- logged before this column existed -- there's no way to reconstruct what
-- tier a past score was actually logged under, so old rows will
-- under-report scaled/beginner entries as Rx on the board until they age
-- out of whatever window the UI shows.
alter table workout_logs
  add column if not exists result_tier athlete_skill_level_enum not null default 'rx';

comment on column workout_logs.result_tier is
  'Scaling tier the athlete was on for this workout''s skill categories when they logged this score (rx/intermediate/beginner) -- set by the client at log time (see components/ScoreForm.tsx), not derived after the fact.';
