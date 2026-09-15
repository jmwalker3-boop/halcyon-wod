'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Avatar from '@/components/Avatar';
import TabBar from '@/components/TabBar';
import TopBar from '@/components/TopBar';
import AddPrForm from '@/components/AddPrForm';

// Raised sticker badge (John's request, 2026-09-15: "the fun stuff like the
// 'PR' skull sticker" -- the /prs page had none of the raised-badge sticker
// treatment TabBar's WOD tab uses). Same visual recipe as that skull badge
// (components/TabBar.tsx: mustard circle, thick ink border, offset
// box-shadow) rather than the WOD tab itself, since the bottom nav's single
// raised slot is locked to WOD; this is a page-header flourish instead.
function TrophyIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 3h12v6c0 3.3-2.7 6-6 6s-6-2.7-6-6V3z" />
      <path d="M6 4H3a1 1 0 0 0-1 1c0 3 2 5 4.3 5.4A6 6 0 0 1 6 9.5V4z" />
      <path d="M18 4h3a1 1 0 0 1 1 1c0 3-2 5-4.3 5.4A6 6 0 0 0 18 9.5V4z" />
      <rect x="10.5" y="13" width="3" height="6" rx="0.5" />
      <rect x="9" y="18" width="6" height="2" rx="0.5" />
      <rect x="7" y="20" width="10" height="2" rx="0.5" />
    </svg>
  );
}

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
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <span
            aria-hidden="true"
            style={{
              width: 48,
              height: 48,
              flexShrink: 0,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--hw-mustard)',
              color: 'var(--hw-ink)',
              border: '3px solid var(--hw-ink)',
              boxShadow: '3px 3px 0 var(--hw-ink)',
              transform: 'rotate(-6deg)',
            }}
          >
            <TrophyIcon size={26} />
          </span>
          <div className="hw-h1" style={{ fontSize: 26 }}>PRs</div>
        </div>
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
