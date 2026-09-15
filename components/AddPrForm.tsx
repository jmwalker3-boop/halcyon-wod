'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// Lets an athlete log a PR for a movement OR a classic benchmark WOD
// (Murph, Fran, Grace...) directly, independent of whether it came from an
// actual logged score -- John's request, 2026-09-15. Companion to
// ScoreForm's auto-detected 'load' PRs (components/ScoreForm.tsx): this
// always inserts (no "only if it beats the current best" check) since the
// whole point is backfilling PRs the app never captured, including old
// ones. /prs page's own grouping picks the best of however many rows exist
// per movement/benchmark, so a lower manual entry just won't surface.
//
// Movements and benchmark workouts are two different tables with no
// shared search, so this is a type-then-list picker (Movement / Benchmark
// toggle) rather than one unified search box -- matches the toggle pattern
// ScoreForm already uses for result-type selection.
type Movement = { id: string; canonical_name: string };
type Benchmark = { id: string; title: string; result_type_override: 'time' | 'rounds_reps' | 'load' | null };

export default function AddPrForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<'movement' | 'benchmark'>('movement');
  const [movements, setMovements] = useState<Movement[]>([]);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [query, setQuery] = useState('');
  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(null);
  const [selectedBenchmark, setSelectedBenchmark] = useState<Benchmark | null>(null);
  const [benchmarkResultType, setBenchmarkResultType] = useState<'time' | 'rounds_reps'>('time');

  const [reps, setReps] = useState('');
  const [weight, setWeight] = useState('');
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [rounds, setRounds] = useState('');
  const [roundReps, setRoundReps] = useState('');
  const [achievedAt, setAchievedAt] = useState(() => new Date().toISOString().slice(0, 10));

  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || movements.length > 0) return;
    (async () => {
      const supabase = createClient();
      const [{ data: m }, { data: b }] = await Promise.all([
        supabase.from('movements').select('id, canonical_name').order('canonical_name', { ascending: true }),
        supabase
          .from('workouts')
          .select('id, title, result_type_override')
          .eq('is_benchmark', true)
          .not('title', 'is', null)
          .order('title', { ascending: true }),
      ]);
      setMovements((m ?? []) as Movement[]);
      setBenchmarks((b ?? []) as Benchmark[]);
    })();
  }, [open, movements.length]);

  function reset() {
    setQuery('');
    setSelectedMovement(null);
    setSelectedBenchmark(null);
    setReps('');
    setWeight('');
    setMinutes('');
    setSeconds('');
    setRounds('');
    setRoundReps('');
    setAchievedAt(new Date().toISOString().slice(0, 10));
    setState('idle');
    setMessage(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState('saving');
    setMessage(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setState('error');
      setMessage('Not signed in.');
      return;
    }

    const achievedAtIso = new Date(`${achievedAt}T12:00:00`).toISOString();

    let insert: {
      profile_id: string;
      movement_id: string | null;
      workout_id: string | null;
      record_type: string;
      result_type: 'load' | 'time' | 'rounds_reps';
      value: number;
      achieved_at: string;
    };

    if (target === 'movement') {
      if (!selectedMovement || !weight || !reps) {
        setState('error');
        setMessage('Pick a movement, then enter reps and weight.');
        return;
      }
      insert = {
        profile_id: user.id,
        movement_id: selectedMovement.id,
        workout_id: null,
        record_type: `${Number(reps)}RM`,
        result_type: 'load',
        value: Number(weight),
        achieved_at: achievedAtIso,
      };
    } else {
      if (!selectedBenchmark) {
        setState('error');
        setMessage('Pick a benchmark.');
        return;
      }
      const resultType = selectedBenchmark.result_type_override === 'rounds_reps' ? 'rounds_reps' : benchmarkResultType;
      if (resultType === 'time') {
        const totalSeconds = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
        if (totalSeconds <= 0) {
          setState('error');
          setMessage('Enter a time.');
          return;
        }
        insert = {
          profile_id: user.id,
          movement_id: null,
          workout_id: selectedBenchmark.id,
          record_type: 'time',
          result_type: 'time',
          value: totalSeconds,
          achieved_at: achievedAtIso,
        };
      } else {
        if (!rounds && !roundReps) {
          setState('error');
          setMessage('Enter rounds and/or reps.');
          return;
        }
        insert = {
          profile_id: user.id,
          movement_id: null,
          workout_id: selectedBenchmark.id,
          record_type: 'rounds_reps',
          result_type: 'rounds_reps',
          value: (Number(rounds) || 0) * 1000 + (Number(roundReps) || 0),
          achieved_at: achievedAtIso,
        };
      }
    }

    const { error } = await supabase.from('personal_records').insert(insert);
    if (error) {
      setState('error');
      setMessage(error.message);
      return;
    }

    setState('saved');
    setMessage('PR added.');
    onAdded();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hw-btn hw-btn-mustard"
        style={{ marginTop: 16, fontSize: 14, padding: 12 }}
      >
        + Add a PR
      </button>
    );
  }

  if (state === 'saved') {
    return (
      <div className="hw-card" style={{ marginTop: 16 }}>
        <p className="hw-pill hw-pill-cyan" style={{ margin: 0 }}>{message}</p>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="hw-btn"
          style={{ marginTop: 10, width: 'auto', padding: '9px 16px', fontSize: 13, border: '2px solid var(--hw-ink)' }}
        >
          Done
        </button>
      </div>
    );
  }

  const q = query.trim().toLowerCase();
  const filteredMovements = q ? movements.filter((m) => m.canonical_name.toLowerCase().includes(q)) : movements;
  const filteredBenchmarks = q ? benchmarks.filter((b) => b.title.toLowerCase().includes(q)) : benchmarks;

  return (
    <form onSubmit={handleSubmit} className="hw-card" style={{ marginTop: 16 }}>
      <span className="hw-label">Add a PR</span>

      <div style={{ display: 'flex', marginTop: 10, border: '3px solid var(--hw-ink)', borderRadius: 999, overflow: 'hidden' }}>
        {(
          [
            { value: 'movement', label: 'MOVEMENT' },
            { value: 'benchmark', label: 'BENCHMARK WOD' },
          ] as { value: 'movement' | 'benchmark'; label: string }[]
        ).map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              setTarget(opt.value);
              setQuery('');
              setSelectedMovement(null);
              setSelectedBenchmark(null);
            }}
            style={{
              flex: 1,
              border: 'none',
              borderLeft: i > 0 ? '3px solid var(--hw-ink)' : 'none',
              padding: '10px 4px',
              font: '700 10px/1 "Space Mono", monospace',
              background: target === opt.value ? 'var(--hw-cyan)' : 'var(--hw-paper)',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {((target === 'movement' && !selectedMovement) || (target === 'benchmark' && !selectedBenchmark)) && (
        <>
          <input
            type="text"
            placeholder={target === 'movement' ? 'Search movements…' : 'Search benchmarks…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...inputStyle, width: '100%', marginTop: 10 }}
          />
          <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {target === 'movement'
              ? filteredMovements.slice(0, 50).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedMovement(m)}
                    className="hw-pill hw-pill-outline"
                    style={{ border: '2px solid var(--hw-ink)', cursor: 'pointer', textAlign: 'left', justifyContent: 'flex-start' }}
                  >
                    {m.canonical_name}
                  </button>
                ))
              : filteredBenchmarks.slice(0, 50).map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBenchmark(b)}
                    className="hw-pill hw-pill-outline"
                    style={{ border: '2px solid var(--hw-ink)', cursor: 'pointer', textAlign: 'left', justifyContent: 'flex-start' }}
                  >
                    {b.title}
                  </button>
                ))}
          </div>
        </>
      )}

      {target === 'movement' && selectedMovement && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="hw-h3" style={{ fontSize: 14 }}>{selectedMovement.canonical_name}</span>
            <button type="button" onClick={() => setSelectedMovement(null)} className="hw-link-back" style={{ fontSize: 12 }}>
              Change
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input type="number" min={0} placeholder="Weight" value={weight} onChange={(e) => setWeight(e.target.value)} style={inputStyle} />
            <input type="number" min={1} placeholder="Reps" value={reps} onChange={(e) => setReps(e.target.value)} style={inputStyle} />
          </div>
        </div>
      )}

      {target === 'benchmark' && selectedBenchmark && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="hw-h3" style={{ fontSize: 14 }}>{selectedBenchmark.title}</span>
            <button type="button" onClick={() => setSelectedBenchmark(null)} className="hw-link-back" style={{ fontSize: 12 }}>
              Change
            </button>
          </div>

          {selectedBenchmark.result_type_override !== 'rounds_reps' && (
            <div style={{ display: 'flex', marginTop: 10, border: '3px solid var(--hw-ink)', borderRadius: 999, overflow: 'hidden' }}>
              {(
                [
                  { value: 'time', label: 'TIME' },
                  { value: 'rounds_reps', label: 'ROUNDS+REPS' },
                ] as { value: 'time' | 'rounds_reps'; label: string }[]
              ).map((opt, i) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setBenchmarkResultType(opt.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    borderLeft: i > 0 ? '3px solid var(--hw-ink)' : 'none',
                    padding: '10px 4px',
                    font: '700 10px/1 "Space Mono", monospace',
                    background: benchmarkResultType === opt.value ? 'var(--hw-cyan)' : 'var(--hw-paper)',
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {(selectedBenchmark.result_type_override === 'rounds_reps' ? 'rounds_reps' : benchmarkResultType) === 'time' ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input type="number" min={0} placeholder="Min" value={minutes} onChange={(e) => setMinutes(e.target.value)} style={inputStyle} />
              <input type="number" min={0} max={59} placeholder="Sec" value={seconds} onChange={(e) => setSeconds(e.target.value)} style={inputStyle} />
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input type="number" min={0} placeholder="Rounds" value={rounds} onChange={(e) => setRounds(e.target.value)} style={inputStyle} />
              <input type="number" min={0} placeholder="+ Reps" value={roundReps} onChange={(e) => setRoundReps(e.target.value)} style={inputStyle} />
            </div>
          )}
        </div>
      )}

      {(selectedMovement || selectedBenchmark) && (
        <div style={{ marginTop: 8 }}>
          <span className="hw-label">When</span>
          <input
            type="date"
            value={achievedAt}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setAchievedAt(e.target.value)}
            style={{ ...inputStyle, width: '100%', marginTop: 4 }}
          />
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="submit" disabled={state === 'saving'} className="hw-btn hw-btn-dark" style={{ width: 'auto', padding: '11px 20px', fontSize: 14 }}>
          {state === 'saving' ? 'Saving…' : 'Save PR'}
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          className="hw-btn"
          style={{ width: 'auto', padding: '11px 20px', fontSize: 14, border: '2px solid var(--hw-ink)' }}
        >
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

