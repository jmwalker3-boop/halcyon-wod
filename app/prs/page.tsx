'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Avatar from '@/components/Avatar';
import TabBar from '@/components/TabBar';
import TopBar from '@/components/TopBar';
import AddPrForm from '@/components/AddPrForm';

// Searchable PR log (John's request, 2026-09-07: "auto detects a PR and
// should be searchable"; extended 2026-09-15 to also support benchmark-WOD
// PRs manually added via AddPrForm, not just movement PRs auto-detected by
// ScoreForm). Keeps the single best row per athlete+target+record_type,
// since a movement or benchmark can have many historical rows but only one
// current best -- "best" means highest value except for 'time' results,
// where lower is better (see isBetter below).
type Row = {
  id: string;
  profile_id: string;
  movement_id: string | null;
  workout_id: string | null;
  record_type: string;
  result_type: 'load' | 'time' | 'rounds_reps';
  value: number;
  achieved_at: string;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
  movements: { canonical_name: string } | null;
  workouts: { title: string | null } | null;
};

// Lower is better for a time PR, higher is better for everything else
// (load PRs are a heavier weight; rounds_reps PRs are encoded
// rounds*1000+reps, same convention leaderboard/[workoutId]/page.tsx uses).
function isBetter(candidate: Row, current: Row) {
  return candidate.result_type === 'time' ? candidate.value < current.value : candidate.value > current.value;
}

function formatValue(r: Row) {
  if (r.result_type === 'time') {
    const m = Math.floor(r.value / 60);
    const s = Math.round(r.value % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  if (r.result_type === 'rounds_reps') {
    return `${Math.floor(r.value / 1000)}+${r.value % 1000}`;
  }
  return `${r.value}`;
}

export default function PrsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');

  async function load() {
    const supabase = createClient();
    const { data, error } = await supabase
      .from('personal_records')
      .select(
        'id, profile_id, movement_id, workout_id, record_type, result_type, value, achieved_at, profiles ( display_name, avatar_url ), movements ( canonical_name ), workouts ( title )',
      )
      .order('value', { ascending: false });
    if (error) {
      setLoadState('error');
      return;
    }
    setRows((data ?? []) as unknown as Row[]);
    setLoadState('ready');
  }

  useEffect(() => {
    load();
  }, []);

  const best = useMemo(() => {
    const key = (r: Row) => `${r.profile_id}::${r.movement_id ?? `w:${r.workout_id}`}::${r.record_type}`;
    const map = new Map<string, Row>();
    for (const r of rows) {
      const existing = map.get(key(r));
      if (!existing || isBetter(r, existing)) map.set(key(r), r);
    }
    return [...map.values()];
  }, [rows]);

  const byMovement = useMemo(() => {
    const q = query.trim().toLowerCase();
    const name = (r: Row) => r.movements?.canonical_name ?? r.workouts?.title ?? 'Unknown';
    const filtered = q ? best.filter((r) => name(r).toLowerCase().includes(q)) : best;
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const list = map.get(name(r)) ?? [];
      list.push(r);
      map.set(name(r), list);
    }
    for (const list of map.values()) list.sort((a, b) => (isBetter(a, b) ? -1 : 1));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [best, query]);

  return (
    <main className="hw-shell">
      <TopBar />
      <div className="hw-wrap" style={{ paddingTop: 90, paddingBottom: 100 }}>
        <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
        <div className="hw-h1" style={{ fontSize: 26 }}>PRs</div>
        <p className="hw-lede">Every current best, by movement or benchmark.</p>

        <AddPrForm onAdded={load} />

        <input
          type="text"
          placeholder="Search a movement or benchmark…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            display: 'block',
            width: '100%',
            marginTop: 16,
            font: '700 14px/1 "Space Grotesk", sans-serif',
            padding: '12px 14px',
            border: '2px solid var(--hw-ink)',
            borderRadius: 8,
            background: 'var(--hw-paper)',
            color: 'var(--hw-ink)',
          }}
        />

        {loadState === 'loading' && <p className="hw-muted" style={{ marginTop: 16 }}>Loading…</p>}
        {loadState === 'error' && <p className="hw-error" style={{ marginTop: 16 }}>Couldn&apos;t load PRs.</p>}

        {loadState === 'ready' && byMovement.length === 0 && (
          <div className="hw-card" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>No PRs {query ? 'match that search.' : 'logged yet — add one above, or set a load score with a movement picked.'}</p>
          </div>
        )}

        {byMovement.map(([movementName, list]) => (
          <div key={movementName} className="hw-card" style={{ marginTop: 12 }}>
            <span className="hw-h3">{movementName}</span>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {list.map((r) => (
                <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span><Avatar name={r.profiles?.display_name ?? 'Athlete'} url={r.profiles?.avatar_url ?? null} />{r.profiles?.display_name ?? 'Athlete'} <span className="hw-pill hw-pill-outline">{r.record_type}</span></span>
                  <span style={{ fontWeight: 700 }}>
                    {formatValue(r)} — {new Date(r.achieved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <TabBar />
    </main>
  );
}
