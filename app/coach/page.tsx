'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Coach Deck (mockup screen 2d), v0. John's own description of the workflow
// (2026-09-05): every Sunday, before the week becomes visible to athletes,
// he reviews Mon-Sun, edits any workout that needs a change, and adjusts
// notes. That maps directly onto existing tables -- no new schema needed
// for the workout content itself, but `workouts` had read-only RLS before
// today (only `calendar_slots` had a coach-write policy), so
// "workouts: owner write" (UPDATE, scoped through calendar_slots ->
// owns_program_cycle(), same ownership chain as calendar_slots' own write
// policy) was added first. See that migration for why UPDATE only, not
// INSERT/DELETE: this page edits workouts that already exist and are
// already linked to a slot, it doesn't create or remove them.
//
// "Notes" here is calendar_slots.override_reason -- the same column Rule 4
// (Exceptions Need a Logical Reason) reads, so a note the coach leaves here
// is also what excuses a doctrine-rule violation on that slot, not a
// separate free-text field invented for this page.
//
// Week selection: defaults to the NEXT Monday-Sun block relative to today
// (so opening this on a Sunday shows the week about to go live), with
// prev/next controls via ?start=YYYY-MM-DD for the rare case a coach reviews
// early/late or wants to look back. Client-side fetch, same pattern as
// app/settings/page.tsx -- RLS (owner/enrolled/coach read policy on
// calendar_slots) already scopes results to what this coach can see, no
// extra filtering needed.
//
// useSearchParams() (not a `searchParams` prop) deliberately -- this is a
// 'use client' page, and the prop form doesn't reactively update on the
// Prev/Next week links' client-side navigation the way the hook does; it
// also needs the Suspense wrapper below or Next's static-render check for
// this route fails the build.

type Slot = {
  id: string;
  date: string;
  day_type: string;
  override_reason: string | null;
  workouts: { id: string; title: string | null; raw_text: string | null; is_benchmark: boolean } | null;
};

function mondayOnOrAfter(d: Date): Date {
  const day = d.getDay();
  const delta = day === 1 ? 0 : ((8 - day) % 7 || 7);
  const monday = new Date(d);
  monday.setDate(d.getDate() + delta);
  return monday;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

export default function CoachDeckPage() {
  return (
    <Suspense
      fallback={
        <main className="hw-shell">
          <div className="hw-wrap">
            <p className="hw-muted">Loading…</p>
          </div>
        </main>
      }
    >
      <CoachDeck />
    </Suspense>
  );
}

function CoachDeck() {
  const searchParams = useSearchParams();
  const weekStart = searchParams.get('start') || toISODate(mondayOnOrAfter(new Date()));
  const weekEnd = addDays(weekStart, 6);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoadState('loading');
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('Not signed in.');
        setLoadState('error');
        return;
      }

      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role !== 'coach' && profile?.role !== 'admin') {
        setLoadState('forbidden');
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('calendar_slots')
        .select('id, date, day_type, override_reason, workouts ( id, title, raw_text, is_benchmark )')
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .order('date');

      if (fetchError) {
        setError(fetchError.message);
        setLoadState('error');
        return;
      }

      setSlots((data ?? []) as unknown as Slot[]);
      setLoadState('ready');
    })();
  }, [weekStart, weekEnd]);

  if (loadState === 'loading') {
    return (
      <main className="hw-shell">
        <div className="hw-wrap">
          <p className="hw-muted">Loading…</p>
        </div>
      </main>
    );
  }

  if (loadState === 'forbidden') {
    return (
      <main className="hw-shell">
        <div className="hw-wrap">
          <Link href="/dashboard" className="hw-link-back">← Back</Link>
          <p style={{ marginTop: 16 }}>Coach Deck is for coaches only.</p>
        </div>
      </main>
    );
  }

  if (loadState === 'error') {
    return (
      <main className="hw-shell">
        <div className="hw-wrap">
          <p className="hw-error">{error}</p>
        </div>
      </main>
    );
  }

  const byDate = new Map(slots.map((s) => [s.date, s]));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
        <div className="hw-eyebrow-row">
          <span className="hw-eyebrow">Coach Deck</span>
          <Link href="/dashboard" className="hw-link-back">Back</Link>
        </div>
        <div className="hw-h1" style={{ fontSize: 26, color: 'var(--hw-ink)', textShadow: 'none' }}>
          Sunday Review
        </div>
        <p className="hw-lede">
          Week of {new Date(`${weekStart}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' – '}
          {new Date(`${weekEnd}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Link href={`/coach?start=${addDays(weekStart, -7)}`} className="hw-pill hw-pill-outline">← Prev week</Link>
          <Link href={`/coach?start=${addDays(weekStart, 7)}`} className="hw-pill hw-pill-outline">Next week →</Link>
        </div>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {days.map((date) => {
            const slot = byDate.get(date);
            const label = new Date(`${date}T00:00:00`)
              .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
              .toUpperCase();

            if (!slot) {
              return (
                <div key={date} className="hw-card" style={{ opacity: 0.6 }}>
                  <span className="hw-eyebrow-light">{label}</span>
                  <p className="hw-muted" style={{ marginTop: 8, marginBottom: 0 }}>No slot scheduled.</p>
                </div>
              );
            }

            return <DayCard key={slot.id} label={label} slot={slot} />;
          })}
        </div>
      </div>
    </main>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function DayCard({ label, slot }: { label: string; slot: Slot }) {
  const [title, setTitle] = useState(slot.workouts?.title ?? '');
  const [rawText, setRawText] = useState(slot.workouts?.raw_text ?? '');
  const [note, setNote] = useState(slot.override_reason ?? '');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaveState('saving');
    setError(null);
    const supabase = createClient();

    if (slot.workouts) {
      const { error: workoutError } = await supabase
        .from('workouts')
        .update({ title: title || null, raw_text: rawText || null })
        .eq('id', slot.workouts.id);
      if (workoutError) {
        setError(workoutError.message);
        setSaveState('error');
        return;
      }
    }

    const { error: slotError } = await supabase
      .from('calendar_slots')
      .update({ override_reason: note || null })
      .eq('id', slot.id);
    if (slotError) {
      setError(slotError.message);
      setSaveState('error');
      return;
    }

    setSaveState('saved');
  }

  return (
    <div className="hw-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        style={{
          padding: '10px 16px',
          borderBottom: '4px solid var(--hw-ink)',
          background: 'var(--hw-mustard)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span className="hw-label">{label}</span>
        <span className="hw-muted" style={{ fontSize: 11, fontWeight: 700 }}>{slot.day_type}</span>
      </div>

      <div style={{ padding: 14 }}>
        {!slot.workouts ? (
          <p className="hw-muted" style={{ margin: 0 }}>Not generated yet.</p>
        ) : (
          <>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Workout title"
              style={{
                width: '100%',
                font: '700 14px/1 "Space Grotesk", sans-serif',
                padding: '10px 12px',
                border: '2px solid var(--hw-ink)',
                borderRadius: 8,
                background: 'var(--hw-paper)',
                color: 'var(--hw-ink)',
                marginBottom: 8,
              }}
            />
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={6}
              placeholder="Workout content"
              style={{
                width: '100%',
                font: '700 12px/1.6 "Space Mono", monospace',
                padding: '10px 12px',
                border: '2px solid var(--hw-ink)',
                borderRadius: 8,
                background: 'var(--hw-paper)',
                color: 'var(--hw-ink)',
                resize: 'vertical',
              }}
            />
          </>
        )}

        <div style={{ marginTop: 10 }}>
          <span className="hw-label" style={{ color: 'var(--hw-violet)' }}>Note (override reason)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why this deviates from doctrine, if it does"
            style={{
              width: '100%',
              font: '400 13px/1 "Space Grotesk", sans-serif',
              padding: '9px 12px',
              border: '2px solid var(--hw-ink)',
              borderRadius: 8,
              background: 'var(--hw-paper)',
              color: 'var(--hw-ink)',
              marginTop: 6,
            }}
          />
        </div>

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saveState === 'saving'}
            className="hw-btn hw-btn-dark"
            style={{ width: 'auto', padding: '9px 18px', fontSize: 13 }}
          >
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {saveState === 'saved' && <span className="hw-pill hw-pill-cyan">Saved</span>}
          {saveState === 'error' && error && <span className="hw-error" style={{ fontSize: 12 }}>{error}</span>}
        </div>
      </div>
    </div>
  );
}

