'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Avatar from '@/components/Avatar';

// Searchable PR log (John's request, 2026-09-07: "auto detects a PR and
// should be searchable"). personal_records already gets a new row from
// ScoreForm whenever a 'load' score beats the athlete's prior best for
// that exact movement+rep-scheme -- this page just reads all of them
// (personal_records: enrolled read, added alongside this page) and keeps
// the single highest value per athlete+movement+rep-scheme, since a
// movement can have many historical rows but only one current best.
type Row = {
  id: string;
  profile_id: string;
  movement_id: string;
  record_type: string;
  value: number;
  achieved_at: string;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
  movements: { canonical_name: string } | null;
};

export default function PrsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [query, setQuery] = useState('');

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('personal_records')
        .select('id, profile_id, movement_id, record_type, value, achieved_at, profiles ( display_name, avatar_url ), movements ( canonical_name )')
        .order('value', { ascending: false });
      if (error) {
        setLoadState('error');
        return;
      }
      setRows((data ?? []) as unknown as Row[]);
      setLoadState('ready');
    })();
  }, []);

  const best = useMemo(() => {
    const key = (r: Row) => `${r.profile_id}::${r.movement_id}::${r.record_type}`;
    const map = new Map<string, Row>();
    for (const r of rows) {
      const existing = map.get(key(r));
      if (!existing || r.value > existing.value) map.set(key(r), r);
    }
    return [...map.values()];
  }, [rows]);

  const byMovement = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? best.filter((r) => r.movements?.canonical_name.toLowerCase().includes(q)) : best;
    const map = new Map<string, Row[]>();
    for (const r of filtered) {
      const name = r.movements?.canonical_name ?? 'Unknown movement';
      const list = map.get(name) ?? [];
      list.push(r);
      map.set(name, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.value - a.value);
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [best, query]);

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
        <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
        <div className="hw-h1" style={{ fontSize: 26 }}>PRs</div>
        <p className="hw-lede">Every current best, by movement.</p>

        <input
          type="text"
          placeholder="Search a movement…"
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
            <p style={{ margin: 0 }}>No PRs {query ? 'match that search.' : 'logged yet — set a load score with a movement picked.'}</p>
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
                    {r.value} — {new Date(r.achieved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
