'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import LogoutButton from '@/components/LogoutButton';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { CalendarSlotStatus, DayType, ResultType } from '@/lib/db/types';

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

type Modality = 'M' | 'G' | 'W';

type Slot = {
  id: string;
  date: string;
  day_type: string;
  target_modalities: Modality[] | null;
  override_reason: string | null;
  status: CalendarSlotStatus;
  workouts: {
    id: string;
    title: string | null;
    raw_text: string | null;
    is_benchmark: boolean;
    coach_notes: string | null;
    scaling_notes: string | null;
    result_type_override: ResultType | null;
    result_type_override_2: ResultType | null;
    allow_multiple_time_scores: boolean;
    minimal_workout_id: string | null;
    minimal: { id: string; raw_text: string | null } | null;
    workout_movements: { movements: { canonical_name: string } | null }[];
  } | null;
};

const RESULT_TYPE_LABEL: Record<ResultType, string> = {
  time: 'Time',
  rounds_reps: 'Rounds + reps',
  load: 'Weight',
  cals: 'Cals',
  reps: 'Reps',
};

const MODALITY_LABEL: Record<Modality, string> = { M: 'Monostructural', G: 'Gymnastic', W: 'Weightlifting' };

// Cell color for the cycle-calendar grid (mockup 2d) -- M+W together reads
// as the heaviest combined day (violet), M alone or M mixed with anything
// but W reads as the metcon color (pink), G (with or without W) reads
// gymnastics (cyan), and W alone reads pure strength (mustard). Matches
// the mockup's own example grid exactly for every combination it shows.
function cellColor(modalities: Modality[]): string {
  const has = (m: Modality) => modalities.includes(m);
  if (has('M') && has('W')) return 'var(--hw-violet)';
  if (has('M')) return 'var(--hw-pink)';
  if (has('G')) return 'var(--hw-cyan)';
  if (has('W')) return 'var(--hw-mustard)';
  return 'var(--hw-paper)';
}

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
  const [userId, setUserId] = useState<string | null>(null);
  const [approveAllState, setApproveAllState] = useState<'idle' | 'saving' | 'error'>('idle');

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
      setUserId(user.id);

      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role !== 'admin') {
        setLoadState('forbidden');
        return;
      }

      const { data, error: fetchError } = await supabase
        .from('calendar_slots')
        .select(
          `id, date, day_type, target_modalities, override_reason, status,
           workouts ( id, title, raw_text, is_benchmark, coach_notes, scaling_notes, result_type_override, result_type_override_2, allow_multiple_time_scores,
             minimal_workout_id, minimal:minimal_workout_id ( id, raw_text ),
             workout_movements ( movements ( canonical_name ) ) )`,
        )
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
          <p style={{ marginTop: 16 }}>Coach Deck is for admins only.</p>
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

  function handleSlotApproved(slotId: string) {
    setSlots((prev) => prev.map((s) => (s.id === slotId ? { ...s, status: 'approved' } : s)));
  }

  async function handleApproveWeek() {
    const draftIds = slots.filter((s) => s.status === 'draft').map((s) => s.id);
    if (draftIds.length === 0 || !userId) return;
    setApproveAllState('saving');
    const supabase = createClient();
    const { error: approveError } = await supabase
      .from('calendar_slots')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: userId })
      .in('id', draftIds);
    if (approveError) {
      setApproveAllState('error');
      return;
    }
    setSlots((prev) => prev.map((s) => (draftIds.includes(s.id) ? { ...s, status: 'approved' } : s)));
    setApproveAllState('idle');
  }

  const draftCount = slots.filter((s) => s.status === 'draft').length;

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
        {/* Logo links back to /dashboard, same as tapping a site's logo goes
            home on any normal site -- this page had no way back to the
            athlete view at all before (John's report, 2026-09-05) other
            than a small text link easy to miss; the logo is the more
            familiar affordance, kept alongside the text link for clarity. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/dashboard" style={{ flex: 'none', lineHeight: 0 }}>
            <img src="/logo-dot.png" alt="HalcyonWod" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="hw-eyebrow">Coach Deck</span>
          </div>
          <Link href="/dashboard" className="hw-link-back">Today&apos;s WOD</Link>
          <LogoutButton />
        </div>
        <div className="hw-h1" style={{ fontSize: 26, color: 'var(--hw-ink)', textShadow: 'none', marginTop: 12 }}>
          Sunday Review
        </div>
        <p className="hw-lede">
          Week of {new Date(`${weekStart}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          {' – '}
          {new Date(`${weekEnd}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href={`/coach?start=${addDays(weekStart, -7)}`} className="hw-pill hw-pill-outline">← Prev week</Link>
          <Link href={`/coach?start=${addDays(weekStart, 7)}`} className="hw-pill hw-pill-outline">Next week →</Link>
          {/* Publishes every draft slot in the loaded week at once -- matches
              John's stated workflow (page-top comment): review Mon-Sun once,
              then the whole week goes live together, not day by day. Each
              DayCard below can still approve/revert a single day on its own
              for the rare case one day needs to be held back or fast-tracked. */}
          {draftCount > 0 && (
            <button
              type="button"
              onClick={handleApproveWeek}
              disabled={approveAllState === 'saving'}
              className="hw-btn hw-btn-dark"
              style={{ width: 'auto', padding: '9px 18px', fontSize: 13 }}
            >
              {approveAllState === 'saving' ? 'Approving…' : `Approve week (${draftCount} draft${draftCount === 1 ? '' : 's'})`}
            </button>
          )}
          {approveAllState === 'error' && <span className="hw-error" style={{ fontSize: 12 }}>Couldn&apos;t approve — try again.</span>}
        </div>

        <div className="hw-card" style={{ marginTop: 16 }}>
          <span className="hw-label">This week's coverage</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5, marginTop: 12 }}>
            {days.map((date) => {
              const slot = byDate.get(date);
              const isRecovery = slot?.day_type === 'Recovery';
              const modalities = slot?.target_modalities ?? [];
              const label = isRecovery ? 'R' : modalities.length ? modalities.join('') : '?';
              return (
                <div
                  key={date}
                  title={new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
                  style={{
                    aspectRatio: '1',
                    border: isRecovery || !slot ? '2px dashed var(--hw-ink)' : '2px solid var(--hw-ink)',
                    borderRadius: 4,
                    background: isRecovery || !slot ? 'transparent' : cellColor(modalities),
                    opacity: isRecovery || !slot ? 0.5 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    font: '700 8px/1 "Space Mono", monospace',
                  }}
                >
                  {label}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', font: '700 8px/1 "Space Mono", monospace' }} className="hw-muted">
            <span>M = {MODALITY_LABEL.M.toUpperCase()}</span>
            <span>G = {MODALITY_LABEL.G.toUpperCase()}</span>
            <span>W = {MODALITY_LABEL.W.toUpperCase()}</span>
            <span>R = RECOVERY</span>
          </div>
        </div>

        {(() => {
          const withModalities = slots.filter((s) => s.target_modalities && s.target_modalities.length > 0);
          if (withModalities.length === 0) return null;
          const counts: Record<Modality, number> = { M: 0, G: 0, W: 0 };
          for (const s of withModalities) {
            for (const m of s.target_modalities ?? []) counts[m] += 1;
          }
          const total = withModalities.length;
          return (
            <div className="hw-card" style={{ marginTop: 12, background: 'var(--hw-violet)', color: 'var(--hw-paper)' }}>
              <span className="hw-label">Modality balance · this week</span>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'flex-end', height: 80 }}>
                {(['M', 'G', 'W'] as Modality[]).map((m) => {
                  const pct = Math.round((counts[m] / total) * 100);
                  return (
                    <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
                      <div style={{ width: '100%', height: `${Math.max(4, pct)}%`, background: cellColor([m]), border: '2px solid var(--hw-ink)', borderRadius: '4px 4px 0 0' }} />
                      <span style={{ font: '700 10px/1 "Space Mono", monospace' }}>{m} {pct}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {(() => {
          const counts = new Map<string, number>();
          for (const s of slots) {
            for (const wm of s.workouts?.workout_movements ?? []) {
              const name = wm.movements?.canonical_name;
              if (!name) continue;
              counts.set(name, (counts.get(name) ?? 0) + 1);
            }
          }
          const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
          if (top.length === 0) return null;
          const max = top[0][1];
          return (
            <div className="hw-card" style={{ marginTop: 12 }}>
              <span className="hw-label">Movement frequency · top {top.length}</span>
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {top.map(([name, count]) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ font: '700 11px/1 "Space Mono", monospace', width: 112, flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name.toUpperCase()}
                    </span>
                    <div style={{ flex: 1, height: 12, background: 'var(--hw-ink)', opacity: 0.1, border: '2px solid var(--hw-ink)', borderRadius: 999, overflow: 'hidden' }}>
                      <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: 'var(--hw-mustard)' }} />
                    </div>
                    <span className="hw-muted" style={{ font: '700 10px/1 "Space Mono", monospace' }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

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

            return <DayCard key={slot.id} label={label} slot={slot} userId={userId} onApproved={handleSlotApproved} />;
          })}
        </div>
      </div>
    </main>
  );
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type ApproveState = 'idle' | 'saving' | 'error';

function DayCard({
  label,
  slot,
  userId,
  onApproved,
}: {
  label: string;
  slot: Slot;
  userId: string | null;
  onApproved: (slotId: string) => void;
}) {
  const [title, setTitle] = useState(slot.workouts?.title ?? '');
  const [rawText, setRawText] = useState(slot.workouts?.raw_text ?? '');
  const [coachNotes, setCoachNotes] = useState(slot.workouts?.coach_notes ?? '');
  const [scalingNotes, setScalingNotes] = useState(slot.workouts?.scaling_notes ?? '');
  const [resultTypeOverride, setResultTypeOverride] = useState<ResultType | null>(slot.workouts?.result_type_override ?? null);
  // Second scoring type for days with two scored pieces (John's request,
  // 2026-09-11: "the days with two pieces need two types of scoring").
  // Only meaningful once resultTypeOverride itself is set -- the checkbox
  // is hidden otherwise.
  const [hasSecondScore, setHasSecondScore] = useState(!!slot.workouts?.result_type_override_2);
  const [resultTypeOverride2, setResultTypeOverride2] = useState<ResultType | null>(slot.workouts?.result_type_override_2 ?? null);
  // Interval-workout flag (John's request, 2026-09-12: "add multiple time
  // scores for interval workouts"). Only meaningful while 'time' is one of
  // the two locked scoring shapes -- see the checkbox below.
  const [allowMultipleTimeScores, setAllowMultipleTimeScores] = useState(!!slot.workouts?.allow_multiple_time_scores);
  const [note, setNote] = useState(slot.override_reason ?? '');
  // DB/KB-and-equipment-free variant shown as the "Minimal" tab on /wod
  // (John's request, 2026-09-29). Lives as its own workouts row, linked via
  // minimal_workout_id -- created on first save if the coach types
  // something here and no linked row exists yet.
  const [minimalRawText, setMinimalRawText] = useState(slot.workouts?.minimal?.raw_text ?? '');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<CalendarSlotStatus>(slot.status);
  const [approveState, setApproveState] = useState<ApproveState>('idle');

  // 'time' can only ever occupy one of the two locked-score slots at once
  // (the second-scoring-type picker excludes whatever the first already
  // is), so checking both covers either position.
  const timeIsLocked = resultTypeOverride === 'time' || (hasSecondScore && resultTypeOverride2 === 'time');

  async function handleSave() {
    setSaveState('saving');
    setError(null);
    const supabase = createClient();

    if (slot.workouts) {
      const { error: workoutError } = await supabase
        .from('workouts')
        .update({
          title: title || null,
          raw_text: rawText || null,
          coach_notes: coachNotes || null,
          scaling_notes: scalingNotes || null,
          result_type_override: resultTypeOverride,
          result_type_override_2: resultTypeOverride && hasSecondScore ? resultTypeOverride2 : null,
          allow_multiple_time_scores: timeIsLocked && allowMultipleTimeScores,
        })
        .eq('id', slot.workouts.id);
      if (workoutError) {
        setError(workoutError.message);
        setSaveState('error');
        return;
      }

      if (slot.workouts.minimal_workout_id) {
        const { error: minimalError } = await supabase
          .from('workouts')
          .update({ raw_text: minimalRawText || null })
          .eq('id', slot.workouts.minimal_workout_id);
        if (minimalError) {
          setError(minimalError.message);
          setSaveState('error');
          return;
        }
      } else if (minimalRawText.trim()) {
        const { data: newMinimal, error: insertError } = await supabase
          .from('workouts')
          .insert({ source: 'generated', day_type: slot.day_type as DayType, raw_text: minimalRawText })
          .select('id')
          .single();
        if (insertError) {
          setError(insertError.message);
          setSaveState('error');
          return;
        }
        const { error: linkError } = await supabase
          .from('workouts')
          .update({ minimal_workout_id: newMinimal.id })
          .eq('id', slot.workouts.id);
        if (linkError) {
          setError(linkError.message);
          setSaveState('error');
          return;
        }
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

  // Approval is the gate that decides whether this slot's already-saved
  // content shows up on the athlete feed (dashboard/wod/board all now
  // require status='approved' to resolve a day) -- separate from Save so a
  // coach can keep editing a draft without it going live, then explicitly
  // publish it, or revert an already-approved day back to draft (e.g. to
  // pull a day back for a last-minute fix) without touching its content.
  async function setSlotStatus(next: CalendarSlotStatus) {
    setApproveState('saving');
    const supabase = createClient();
    const { error: statusError } = await supabase
      .from('calendar_slots')
      .update(
        next === 'approved'
          ? { status: 'approved', approved_at: new Date().toISOString(), approved_by: userId }
          : { status: 'draft', approved_at: null, approved_by: null },
      )
      .eq('id', slot.id);
    if (statusError) {
      setApproveState('error');
      return;
    }
    setStatus(next);
    setApproveState('idle');
    if (next === 'approved') onApproved(slot.id);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="hw-muted" style={{ fontSize: 11, fontWeight: 700 }}>{slot.day_type}</span>
          <span className={status === 'approved' ? 'hw-pill hw-pill-cyan' : 'hw-pill hw-pill-outline'} style={{ fontSize: 10 }}>
            {status === 'approved' ? 'On feed' : 'Draft'}
          </span>
        </div>
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

            {/* "Minimal" tab on /wod (John's request, 2026-09-29): a
                DB/KB-and-equipment-free variant of the same workout. Blank
                until a coach writes one -- /wod shows "not generated yet"
                until then. Approved alongside the rest of this day, not
                separately. */}
            <span className="hw-label" style={{ display: 'block', marginTop: 10 }}>Minimal version (DB/KB, no equipment)</span>
            <textarea
              value={minimalRawText}
              onChange={(e) => setMinimalRawText(e.target.value)}
              rows={6}
              placeholder="DB/KB and equipment-free version of this workout"
              style={{
                width: '100%',
                font: '700 12px/1.6 "Space Mono", monospace',
                padding: '10px 12px',
                border: '2px solid var(--hw-ink)',
                borderRadius: 8,
                background: 'var(--hw-paper)',
                color: 'var(--hw-ink)',
                marginTop: 6,
                resize: 'vertical',
              }}
            />

            {/* Athlete-facing -- shown in the dashboard's "Notes" section
                (John's request, 2026-09-06), distinct from the
                override_reason note below (that one is the internal
                doctrine-exception reason, never shown to athletes). */}
            <textarea
              value={coachNotes}
              onChange={(e) => setCoachNotes(e.target.value)}
              rows={2}
              placeholder="Notes for athletes (shown on their dashboard)"
              style={{
                width: '100%',
                font: '400 13px/1.5 "Space Grotesk", sans-serif',
                padding: '10px 12px',
                border: '2px solid var(--hw-ink)',
                borderRadius: 8,
                background: 'var(--hw-paper)',
                color: 'var(--hw-ink)',
                marginTop: 8,
                resize: 'vertical',
              }}
            />
            <textarea
              value={scalingNotes}
              onChange={(e) => setScalingNotes(e.target.value)}
              rows={2}
              placeholder='Scaling guidance for athletes (e.g. "no rower? sub 20 cal bike")'
              style={{
                width: '100%',
                font: '400 13px/1.5 "Space Grotesk", sans-serif',
                padding: '10px 12px',
                border: '2px solid var(--hw-ink)',
                borderRadius: 8,
                background: 'var(--hw-paper)',
                color: 'var(--hw-ink)',
                marginTop: 8,
                resize: 'vertical',
              }}
            />

            {/* Scoring lock (John's request, 2026-09-07: "allow the admin
                to assign the scoring options for wods and not leave it up
                to the athletes, it could be confusing") -- null keeps
                ScoreForm's picker (athlete chooses); picking one of the
                three locks it to that shape only. Only the shapes
                ScoreForm actually implements are offered here -- 'cals'/
                'reps' exist in the DB enum but have no form fields yet. */}
            <span className="hw-label" style={{ display: 'block', marginTop: 10 }}>Scoring for athletes</span>
            <div style={{ display: 'flex', marginTop: 6, border: '3px solid var(--hw-ink)', borderRadius: 999, overflow: 'hidden' }}>
              {(
                [
                  { value: null, label: "ATHLETE'S CHOICE" },
                  { value: 'time', label: 'TIME' },
                  { value: 'rounds_reps', label: 'ROUNDS+REPS' },
                  { value: 'load', label: 'WEIGHT' },
                ] as { value: ResultType | null; label: string }[]
              ).map((opt, i) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setResultTypeOverride(opt.value)}
                  style={{
                    flex: 1,
                    border: 'none',
                    borderLeft: i > 0 ? '3px solid var(--hw-ink)' : 'none',
                    padding: '9px 4px',
                    font: '700 9px/1.2 "Space Mono", monospace',
                    background: resultTypeOverride === opt.value ? 'var(--hw-cyan)' : 'var(--hw-paper)',
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {resultTypeOverride && (
              <p className="hw-muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
                Athletes will only be able to log a {RESULT_TYPE_LABEL[resultTypeOverride].toLowerCase()} score for this WOD.
              </p>
            )}

            {/* Second scoring type (John's request, 2026-09-11: "the days
                with two pieces need two types of scoring") -- only offered
                once a first scoring type is locked, since ScoreForm needs a
                concrete pair of shapes to choose between, not one locked
                type plus an open-ended second. */}
            {resultTypeOverride && (
              <div style={{ marginTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={hasSecondScore}
                    onChange={(e) => setHasSecondScore(e.target.checked)}
                  />
                  <span className="hw-label" style={{ margin: 0 }}>This WOD has two scored pieces</span>
                </label>
                {hasSecondScore && (
                  <>
                    <span className="hw-label" style={{ display: 'block', marginTop: 8 }}>Second scoring type</span>
                    <div style={{ display: 'flex', marginTop: 6, border: '3px solid var(--hw-ink)', borderRadius: 999, overflow: 'hidden' }}>
                      {(
                        [
                          { value: 'time', label: 'TIME' },
                          { value: 'rounds_reps', label: 'ROUNDS+REPS' },
                          { value: 'load', label: 'WEIGHT' },
                        ] as { value: ResultType; label: string }[]
                      )
                        .filter((opt) => opt.value !== resultTypeOverride)
                        .map((opt, i) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setResultTypeOverride2(opt.value)}
                            style={{
                              flex: 1,
                              border: 'none',
                              borderLeft: i > 0 ? '3px solid var(--hw-ink)' : 'none',
                              padding: '9px 4px',
                              font: '700 9px/1.2 "Space Mono", monospace',
                              background: resultTypeOverride2 === opt.value ? 'var(--hw-cyan)' : 'var(--hw-paper)',
                              cursor: 'pointer',
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                    </div>
                    {resultTypeOverride2 && (
                      <p className="hw-muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
                        Athletes will pick between {RESULT_TYPE_LABEL[resultTypeOverride].toLowerCase()} and{' '}
                        {RESULT_TYPE_LABEL[resultTypeOverride2].toLowerCase()} for this WOD.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Interval-workout flag (John's request, 2026-09-12: "add
                multiple time scores for interval workouts... when 'time'
                is selected as a scoring option, allow check marks for
                additional scores to be added"). Only offered once 'time'
                is actually locked as one of the scoring shapes -- it has
                nothing to attach to otherwise. */}
            {timeIsLocked && (
              <div style={{ marginTop: 10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={allowMultipleTimeScores}
                    onChange={(e) => setAllowMultipleTimeScores(e.target.checked)}
                  />
                  <span className="hw-label" style={{ margin: 0 }}>Interval workout (allow multiple time scores)</span>
                </label>
                {allowMultipleTimeScores && (
                  <p className="hw-muted" style={{ fontSize: 11, marginTop: 6, marginBottom: 0 }}>
                    Athletes will be able to add a time for each interval instead of just one.
                  </p>
                )}
              </div>
            )}
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

        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
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

          {status === 'draft' ? (
            <button
              type="button"
              onClick={() => setSlotStatus('approved')}
              disabled={approveState === 'saving'}
              className="hw-btn hw-btn-mustard"
              style={{ width: 'auto', padding: '9px 18px', fontSize: 13 }}
            >
              {approveState === 'saving' ? 'Approving…' : 'Approve for feed'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSlotStatus('draft')}
              disabled={approveState === 'saving'}
              className="hw-pill hw-pill-outline"
              style={{ cursor: 'pointer', border: '2px solid var(--hw-ink)' }}
            >
              {approveState === 'saving' ? 'Reverting…' : 'Revert to draft'}
            </button>
          )}
          {approveState === 'error' && <span className="hw-error" style={{ fontSize: 12 }}>Couldn&apos;t update status — try again.</span>}
        </div>
      </div>
    </div>
  );
}
