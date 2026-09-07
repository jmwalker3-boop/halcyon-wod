'use client';

import { useState } from 'react';

// AS WRITTEN / MY RX toggle (mockup screen 2b) -- both panes are rendered
// server-side and handed down as children; this just shows one at a time.
// Keeping the split at the client/server boundary this way means the
// (possibly expensive) resolver output computed in app/dashboard/page.tsx
// doesn't need a second round trip just to flip a tab.
export default function WodTabs({ asWritten, myRx }: { asWritten: React.ReactNode; myRx: React.ReactNode }) {
  const [tab, setTab] = useState<'as_written' | 'my_rx'>('my_rx');

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => setTab('as_written')}
          className="hw-btn"
          style={{
            width: 'auto',
            padding: '11px 16px',
            fontSize: 12,
            border: '3px solid var(--hw-ink)',
            background: tab === 'as_written' ? 'var(--hw-pink)' : 'var(--hw-paper)',
            color: tab === 'as_written' ? 'var(--hw-paper)' : 'var(--hw-ink)',
            boxShadow: tab === 'as_written' ? '3px 3px 0 var(--hw-ink)' : undefined,
          }}
        >
          As written
        </button>
        <button
          type="button"
          onClick={() => setTab('my_rx')}
          className="hw-btn"
          style={{
            width: 'auto',
            padding: '11px 16px',
            fontSize: 12,
            border: '3px solid var(--hw-ink)',
            background: tab === 'my_rx' ? 'var(--hw-pink)' : 'var(--hw-paper)',
            color: tab === 'my_rx' ? 'var(--hw-paper)' : 'var(--hw-ink)',
            boxShadow: tab === 'my_rx' ? '3px 3px 0 var(--hw-ink)' : undefined,
          }}
        >
          My Rx
        </button>
      </div>
      <div style={{ marginTop: 12 }}>{tab === 'as_written' ? asWritten : myRx}</div>
    </div>
  );
}
