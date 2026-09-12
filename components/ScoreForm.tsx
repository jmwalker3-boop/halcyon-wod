'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AthleteSkillLevel, ResultType } from '@/lib/db/types';

// Score entry for a WOD card on /dashboard. Scoped under John's own model
// (2026-09-07): by default a WOD's scoring format isn't tagged ahead of
// time in the data -- the athlete just picks whichever of the three
// shapes matches what they did (time / rounds+reps / weight+sets+reps)
// when they log it. A coach can lock this down per-WOD from Coach Deck
// (workouts.result_type_override, see lockedResultType below) when
// leaving it up to the athlete would be confusing -- e.g. a workout with
// only one sensible scoring shape. 'load' additionally requires a
// movement (for PR comparison below);
// picked from the full movement catalog rather than restricted to this
// WOD's own movements, since a "load" entry might record e.g. a strength
// piece buried in an accessory block that workout_movements doesn't carry
// prescribed-load structure for yet.
//
// PR auto-detection: a rep scheme is its own record class ("5RM" is not
// compared against "1RM") -- reps per set from the form becomes
// personal_records.record_type, and a new row only gets written when this
// weight beats the current best for that exact movement+rep-scheme.
type Movement = { id: string; canonical_name: string };

const RESULT_TYPE_LABEL: Record<string, string> = { time: 'Time', rounds_reps: 'Rounds + reps', load: 'Weight' };

// One row of the time entry -- plain minutes/seconds strings, same shape
// as the original single-time fields. An interval workout logs one of
// these per interval instead of just one.
type TimeEntry = { minutes: string; seconds: string };

export default function ScoreForm({
  workoutId,
  calendarSlotId,
  movements,
  tier = 'rx',
  lockedResultType = null,
  lockedResultType2 = null,
  allowMultipleTimeScores = false,
}: {
  workoutId: string;
  calendarSlotId: string | null;
  movements: Movement[];
  // The athlete's own scaling tier for this workout's skill categories
  // (see dashboard/page.tsx's tierForSlot) -- stored on the log so the
  // leaderboard can filter/badge by silo without re-deriving it later.
  // Defaults to 'rx' for any caller that doesn't have it computed yet.
  tier?: AthleteSkillLevel;
  // Coach-set workouts.result_type_override (John's request, 2026-09-07:
  // "allow the admin to assign the scoring options for wods and not leave
  // it up to the athletes, it could be confusing"). Null (the default)
  // keeps the original behavior -- athlete picks whichever of the three
  // shapes matches what they did; a set value hides the picker entirely
  // and locks the form to that one shape.
  lockedResultType?: ResultType | null;
  // Second coach-locked shape (John's request, 2026-09-11: "days with two
  // pieces need two types of scoring"). Only meaningful when
  // lockedResultType is also set -- with both present, the athlete picks
  // between exactly these two shapes instead of a locked single shape or
  // the full three-way picker.
  lockedResultType2?: ResultType | null;
  // Interval-workout flag (John's request, 2026-09-12: "add multiple time
  // scores for interval workouts"). When true and 'time' is the active
  // result type, shows a list of time entries plus an "add another
  // interval" control instead of a single minutes/seconds pair.
  allowMultipleTimeScores?: boolean;
}) {
  const hasTwoLocked = !!(lockedResultType && lockedResultType2);
  const [open, setOpen] = useState(false);
  const [resultType, setResultType] = useState<ResultType>(lockedResultType ?? 'time');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([{ minutes: '', seconds: '' }]);
  const [rounds, setRounds] = useState('');
  const [reps, setReps] = useState('');
  const [movementId, setMovementId] = useState('');
  const [weight, setWeight] = useState('');
  const [sets, setSets] = useState('');
  const [loadReps, setLoadReps] = useState('');
  const [rpe, setRpe] = useState('');
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [newPr, setNewPr] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState('saving');
    setMessage(null);
    setNewPr(false);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setState('error');
      setMessage('Not signed in.');
      return;
    }

    let resultValue: Record<string, unknown>;
    if (resultType === 'time') {
      if (allowMultipleTimeScores) {
        const intervalSeconds = timeEntries
          .map((t) => (Number(t.minutes) || 0) * 60 + (Number(t.seconds) || 0))
          .filter((s) => s > 0);
        if (intervalSeconds.length === 0) {
          setState('error');
          setMessage('Enter at least one interval time.');
          return;
        }
        const totalSeconds = intervalSeconds.reduce((a, b) => a + b, 0);
        // `seconds` stays a single total so existing sorting/display code
        // (leaderboard, dashboard) keeps working unchanged; `intervals`
        // carries the individual times for anything that wants the
        // breakdown. Only added when there's more than one -- a single
        // entry logs identically to the non-interval case.
        resultValue = intervalSeconds.length > 1 ? { seconds: totalSeconds, intervals: intervalSeconds } : { seconds: totalSeconds };
      } else {
        const totalSeconds = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
        if (totalSeconds <= 0) {
          setState('error');
          setMessage('Enter a time.');
          return;
        }
        resultValue = { seconds: totalSeconds };
      }
    } else if (resultType === 'rounds_reps') {
      if (!rounds && !reps) {
        setState('error');
        setMessage('Enter rounds and/or reps.');
        return;
      }
      resultValue = { rounds: Number(rounds) || 0, reps: Number(reps) || 0 };
    } else {
      if (!movementId || !weight || !loadReps) {
        setState('error');
        setMessage('Movement, weight, and reps per set are required.');
        return;
      }
      resultValue = { weight: Number(weight), sets: Number(sets) || 1, reps: Number(loadReps) };
    }

    const { data: log, error: logError } = await supabase
      .from('workout_logs')
      .insert({
        profile_id: user.id,
        calendar_slot_id: calendarSlotId,
        workout_id: workoutId,
        movement_id: resultType === 'load' ? movementId : null,
        result_type: resultType,
        result_value: resultValue,
        rpe: rpe ? Number(rpe) : null,
        result_tier: tier,
      })
      .select('id')
      .single();

    if (logError || !log) {
      setState('error');
      setMessage(logError?.message ?? 'Save failed.');
      return;
    }

    if (resultType === 'load') {
      const recordType = `${Number(loadReps)}RM`;
      const { data: best } = await supabase
        .from('personal_records')
        .select('value')
        .eq('profile_id', user.id)
        .eq('movement_id', movementId)
        .eq('record_type', recordType)
        .order('value', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!best || Number(weight) > best.value) {
        const { error: prError } = await supabase.from('personal_records').insert({
          profile_id: user.id,
          movement_id: movementId,
          record_type: recordType,
          value: Number(weight),
          achieved_at: new Date().toISOString(),
          workout_log_id: log.id,
        });
        if (!prError) setNewPr(true);
      }
    }

    if (comment.trim()) {
      await supabase.from('posts').insert({
        profile_id: user.id,
        body: comment.trim(),
        workout_log_id: log.id,
      });
    }

    setState('saved');
    setMessage('Score logged.');
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hw-btn hw-btn-dark"
        style={{ marginTop: 10, fontSize: 14, padding: 12 }}
      >
        Log your score
      </button>
    );
  }

  if (state === 'saved') {
    return (
      <div className="hw-card" style={{ marginTop: 10 }}>
        <p className="hw-pill hw-pill-cyan" style={{ margin: 0 }}>{message}</p>
        {newPr && <p className="hw-pill hw-pill-mustard" style={{ marginTop: 8 }}>New PR! 🎉</p>}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="hw-card" style={{ marginTop: 10 }}>
      <span className="hw-label">Log your score</span>

      {hasTwoLocked ? (
        <div style={{ display: 'flex', marginTop: 10, border: '3px solid var(--hw-ink)', borderRadius: 999, overflow: 'hidden' }}>
          {[lockedResultType, lockedResultType2].map((rt, i) => (
            <button
              key={rt}
              type="button"
              onClick={() => setResultType(rt as ResultType)}
              style={{
                flex: 1,
                border: 'none',
                borderLeft: i > 0 ? '3px solid var(--hw-ink)' : 'none',
                padding: '10px 4px',
                font: '700 10px/1 "Space Mono", monospace',
                background: resultType === rt ? 'var(--hw-cyan)' : 'var(--hw-paper)',
                cursor: 'pointer',
              }}
            >
              {(RESULT_TYPE_LABEL[rt as ResultType] ?? rt).toUpperCase()}
            </button>
          ))}
        </div>
      ) : lockedResultType ? (
        <p className="hw-muted" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
          Scoring for this WOD: <strong>{RESULT_TYPE_LABEL[lockedResultType] ?? lockedResultType}</strong>
        </p>
      ) : (
        <div style={{ display: 'flex', marginTop: 10, border: '3px solid var(--hw-ink)', borderRadius: 999, overflow: 'hidden' }}>
          {(
            [
              { value: 'time', label: 'TIME' },
              { value: 'rounds_reps', label: 'ROUNDS+REPS' },
              { value: 'load', label: 'WEIGHT' },
            ] as { value: ResultType; label: string }[]
          ).map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setResultType(opt.value)}
              style={{
                flex: 1,
                border: 'none',
                borderLeft: i > 0 ? '3px solid var(--hw-ink)' : 'none',
                padding: '10px 4px',
                font: '700 10px/1 "Space Mono", monospace',
                background: resultType === opt.value ? 'var(--hw-cyan)' : 'var(--hw-paper)',
                cursor: 'pointer',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {resultType === 'time' && !allowMultipleTimeScores && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            type="number"
            min={0}
            placeholder="Min"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            style={inputStyle}
          />
          <input
            type="number"
            min={0}
            max={59}
            placeholder="Sec"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            style={inputStyle}
          />
        </div>
      )}

      {/* Interval workout (John's request, 2026-09-12: "add multiple time
          scores for interval workouts") -- one Min/Sec row per interval,
          with an "add another" control instead of the single pair above. */}
      {resultType === 'time' && allowMultipleTimeScores && (
        <div style={{ marginTop: 12 }}>
          {timeEntries.map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginTop: i > 0 ? 8 : 0, alignItems: 'center' }}>
              <span className="hw-muted" style={{ fontSize: 11, width: 20, flexShrink: 0 }}>#{i + 1}</span>
              <input
                type="number"
                min={0}
                placeholder="Min"
                value={entry.minutes}
                onChange={(e) => {
                  const next = [...timeEntries];
                  next[i] = { ...next[i]!, minutes: e.target.value };
                  setTimeEntries(next);
                }}
                style={inputStyle}
              />
              <input
                type="number"
                min={0}
                max={59}
                placeholder="Sec"
                value={entry.seconds}
                onChange={(e) => {
                  const next = [...timeEntries];
                  next[i] = { ...next[i]!, seconds: e.target.value };
                  setTimeEntries(next);
                }}
                style={inputStyle}
              />
              {timeEntries.length > 1 && (
                <button
                  type="button"
                  onClick={() => setTimeEntries(timeEntries.filter((_, j) => j !== i))}
                  aria-label={`Remove interval ${i + 1}`}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTimeEntries([...timeEntries, { minutes: '', seconds: '' }])}
            className="hw-pill hw-pill-outline"
            style={{ marginTop: 8, border: '2px solid var(--hw-ink)', cursor: 'pointer' }}
          >
            + Add another interval
          </button>
        </div>
      )}

      {resultType === 'rounds_reps' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input
            type="number"
            min={0}
            placeholder="Rounds"
            value={rounds}
            onChange={(e) => setRounds(e.target.value)}
            style={inputStyle}
          />
          <input
            type="number"
            min={0}
            placeholder="+ Reps"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            style={inputStyle}
          />
        </div>
      )}

      {resultType === 'load' && (
        <div style={{ marginTop: 12 }}>
          <select value={movementId} onChange={(e) => setMovementId(e.target.value)} style={{ ...inputStyle, width: '100%' }}>
            <option value="">Movement…</option>
            {movements.map((m) => (
              <option key={m.id} value={m.id}>{m.canonical_name}</option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input type="number" min={0} placeholder="Weight" value={weight} onChange={(e) => setWeight(e.target.value)} style={inputStyle} />
            <input type="number" min={1} placeholder="Sets" value={sets} onChange={(e) => setSets(e.target.value)} style={inputStyle} />
            <input type="number" min={1} placeholder="Reps/set" value={loadReps} onChange={(e) => setLoadReps(e.target.value)} style={inputStyle} />
          </div>
        </div>
      )}

      <input
        type="number"
        min={1}
        max={10}
        placeholder="RPE (optional)"
        value={rpe}
        onChange={(e) => setRpe(e.target.value)}
        style={{ ...inputStyle, width: '100%', marginTop: 8 }}
      />
      <textarea
        placeholder="Comment for the leaderboard (optional)"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={2}
        style={{ ...inputStyle, width: '100%', marginTop: 8, resize: 'vertical' }}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="submit" disabled={state === 'saving'} className="hw-btn hw-btn-dark" style={{ width: 'auto', padding: '11px 20px', fontSize: 14 }}>
          {state === 'saving' ? 'Saving…' : 'Save score'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="hw-btn" style={{ width: 'auto', padding: '11px 20px', fontSize: 14, border: '2px solid var(--hw-ink)' }}>
          Cancel
        </button>
      </div>
      {state === 'error' && message && <p className="hw-error" style={{ marginTop: 8, fontSize: 12 }}>{message}</p>}
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  font: '700 13px/1 "Space Grotesk", sans-serif',
  padding: '10px 12px',
  border: '2px solid var(--hw-ink)',
  borderRadius: 8,
  background: 'var(--hw-paper)',
  color: 'var(--hw-ink)',
};
