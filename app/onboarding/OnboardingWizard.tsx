'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export type Track = {
  id: string;
  name: string;
  lengthDays: number | null;
  formatPattern: string | null;
};

export default function OnboardingWizard({ tracks }: { tracks: Track[] }) {
  const router = useRouter();
  const [trackId, setTrackId] = useState<string | null>(tracks.length === 1 ? tracks[0].id : null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleFinish() {
    if (!trackId) return;
    setSaveState('saving');
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaveState('error');
      setError('Not signed in.');
      return;
    }

    const { error: enrollError } = await supabase
      .from('program_enrollments')
      .upsert({ profile_id: user.id, program_id: trackId, active: true }, { onConflict: 'profile_id,program_id' });
    if (enrollError) {
      setSaveState('error');
      setError(enrollError.message);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <main className="hw-shell">
      <div className="hw-wrap" style={{ textAlign: 'center', paddingTop: 40 }}>
        <img src="/logo-dot.png" alt="HalcyonWod" style={{ width: 88, height: 88, objectFit: 'contain', margin: '0 auto' }} />
        <div className="hw-h1" style={{ fontSize: 22, marginTop: 10 }}>PICK YOUR TRACK</div>
        <p className="hw-lede">One question and you&apos;re in. This decides what shows up on your board every morning.</p>
      </div>

      <div className="hw-wrap" style={{ paddingTop: 0, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {tracks.length === 0 && (
          <div className="hw-card">
            <p style={{ margin: 0 }}>No tracks are set up yet — ask your coach to create one.</p>
          </div>
        )}

        {tracks.map((track) => {
          const selected = trackId === track.id;
          return (
            <button
              key={track.id}
              type="button"
              onClick={() => setTrackId(track.id)}
              className="hw-card"
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                padding: 0,
                overflow: 'hidden',
                border: selected ? '4px solid var(--hw-pink)' : '4px solid var(--hw-ink)',
              }}
            >
              <div
                style={{
                  padding: '12px 14px',
                  borderBottom: '4px solid var(--hw-ink)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span className="hw-h2" style={{ fontSize: 17 }}>{track.name}</span>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    flex: 'none',
                    borderRadius: '50%',
                    border: '3px solid var(--hw-ink)',
                    background: selected ? 'var(--hw-pink)' : 'var(--hw-paper)',
                    color: 'var(--hw-paper)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    font: '700 12px/1 "Space Mono", monospace',
                  }}
                >
                  {selected ? '✓' : ''}
                </span>
              </div>
              <div style={{ padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {track.lengthDays != null && (
                  <span className="hw-pill hw-pill-outline">{track.lengthDays}-DAY CYCLE</span>
                )}
                {track.formatPattern && <span className="hw-pill hw-pill-outline">{track.formatPattern}</span>}
              </div>
            </button>
          );
        })}

        <button
          type="button"
          disabled={!trackId || saveState === 'saving'}
          onClick={handleFinish}
          className="hw-btn hw-btn-dark"
          style={{ marginTop: 4, opacity: trackId ? 1 : 0.5 }}
        >
          {saveState === 'saving' ? 'Locking in…' : "Lock it in"}
        </button>
        {saveState === 'error' && error && <p className="hw-error" style={{ marginTop: 4 }}>{error}</p>}
        <p className="hw-muted" style={{ textAlign: 'center', fontSize: 11, fontWeight: 700 }}>
          YOU CAN SWITCH TRACKS ANY TIME
        </p>
      </div>
    </main>
  );
}
