'use client';

import { useState } from 'react';

// RX / SCALED / MINIMAL toggle (replaces the old As Written / My Rx toggle,
// John's call 2026-09-29): fixed, pre-authored workout variants instead of
// live per-athlete equipment/skill resolution. All three panes are rendered
// server-side and handed down as children; this just shows one at a time.
export default function WodTabs({ rx, scaled, minimal }: { rx: React.ReactNode; scaled: React.ReactNode; minimal: React.ReactNode }) {
  const [tab, setTab] = useState<'rx' | 'scaled' | 'minimal'>('rx');

  const TABS: { key: 'rx' | 'scaled' | 'minimal'; label: string }[] = [
    { key: 'rx', label: 'Rx' },
    { key: 'scaled', label: 'Scaled' },
    { key: 'minimal', label: 'Minimal' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className="hw-btn"
            style={{
              width: 'auto',
              padding: '11px 16px',
              fontSize: 12,
              border: '3px solid var(--hw-ink)',
              background: tab === t.key ? 'var(--hw-pink)' : 'var(--hw-paper)',
              color: tab === t.key ? 'var(--hw-paper)' : 'var(--hw-ink)',
              boxShadow: tab === t.key ? '3px 3px 0 var(--hw-ink)' : undefined,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>{tab === 'rx' ? rx : tab === 'scaled' ? scaled : minimal}</div>
    </div>
  );
}
