'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  EQUIPMENT_GROUPS,
  EQUIPMENT_OPTIONS,
  SKILL_CATEGORIES,
  SKILL_REQUIRES_EQUIPMENT,
  type SkillLevelValue,
} from '@/lib/equipment';

export type Track = {
  id: string;
  name: string;
  lengthDays: number | null;
  formatPattern: string | null;
};

type Step = 1 | 2 | 3;

const EQUIPMENT_LABEL = new Map(EQUIPMENT_OPTIONS.map((o) => [o.tag, o.label]));

function ProgressDots({ step }: { step: Step }) {
  return (
    <div className="hw-progress-dots">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className={`hw-progress-dot${i <= step ? ' hw-progress-dot-on' : ''}`} />
      ))}
    </div>
  );
}

export default function OnboardingWizard({ tracks }: { tracks: Track[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [trackId, setTrackId] = useState<string | null>(tracks.length === 1 ? tracks[0].id : null);
  const [equipment, setEquipment] = useState<Set<string>>(new Set());
  const [skillLevels, setSkillLevels] = useState<Record<string, SkillLevelValue>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  function toggleEquipment(tag: string) {
    setEquipment((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function handleFinish() {
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

    if (equipment.size > 0) {
      const { error: equipmentError } = await supabase
        .from('profile_equipment')
        .insert([...equipment].map((equipment_tag) => ({ profile_id: user.id, equipment_tag })));
      if (equipmentError) {
        setSaveState('error');
        setError(equipmentError.message);
        return;
      }
    }

    // Same "no row means Rx" convention as /account -- only categories moved
    // off Rx (and not gated by a missing apparatus) get a row.
    const skillRows = SKILL_CATEGORIES.filter((c) => {
      const requiredTag = SKILL_REQUIRES_EQUIPMENT[c.key];
      const gated = requiredTag != null && !equipment.has(requiredTag);
      const level = skillLevels[c.key] ?? 'rx';
      return !gated && level !== 'rx';
    }).map((c) => ({
      profile_id: user.id,
      skill_category: c.key,
      level: skillLevels[c.key] as SkillLevelValue,
      updated_at: new Date().toISOString(),
    }));
    if (skillRows.length > 0) {
      const { error: skillError } = await supabase.from('profile_skill_levels').upsert(skillRows, {
        onConflict: 'profile_id,skill_category',
      });
      if (skillError) {
        setSaveState('error');
        setError(skillError.message);
        return;
      }
    }

    if (trackId) {
      const { error: enrollError } = await supabase
        .from('program_enrollments')
        .upsert({ profile_id: user.id, program_id: trackId, active: true }, { onConflict: 'profile_id,program_id' });
      if (enrollError) {
        setSaveState('error');
        setError(enrollError.message);
        return;
      }
    }

    router.push('/dashboard');
    router.refresh();
  }

  if (step === 1) {
    return (
      <main className="hw-shell">
        <div className="hw-wrap" style={{ textAlign: 'center', paddingTop: 40 }}>
          <img src="/logo-dot.png" alt="HalcyonWod" style={{ width: 88, height: 88, objectFit: 'contain', margin: '0 auto' }} />
          <div className="hw-h1" style={{ fontSize: 22, marginTop: 10 }}>PICK YOUR TRACK</div>
          <p className="hw-lede">Four questions and you&apos;re in. This one decides what shows up on your board every morning.</p>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
            <ProgressDots step={1} />
          </div>
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
            disabled={!trackId}
            onClick={() => setStep(2)}
            className="hw-btn hw-btn-dark"
            style={{ marginTop: 4, opacity: trackId ? 1 : 0.5 }}
          >
            Next — your gear
          </button>
          <p className="hw-muted" style={{ textAlign: 'center', fontSize: 11, fontWeight: 700 }}>
            YOU CAN SWITCH TRACKS ANY TIME
          </p>
        </div>
      </main>
    );
  }

  if (step === 2) {
    return (
      <main className="hw-shell-mustard">
        <div className="hw-wrap">
          <ProgressDots step={2} />
          <div className="hw-h1" style={{ fontSize: 26, marginTop: 14 }}>WHAT&apos;VE YOU<br />ACTUALLY GOT?</div>
          <p className="hw-lede">
            Check what&apos;s really in your gym. Anything you skip, we scale around — no guilt, no missing-equipment nags.
          </p>
          <span className="hw-eyebrow" style={{ marginTop: 12, display: 'inline-block' }}>
            {equipment.size} OF {EQUIPMENT_OPTIONS.length} CHECKED
          </span>
        </div>

        <div className="hw-wrap" style={{ paddingTop: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {EQUIPMENT_GROUPS.map((group) => (
            <div key={group.label} className="hw-card">
              <div className="hw-label">{group.label.toUpperCase()}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {group.tags.map((tag) => {
                  const on = equipment.has(tag);
                  return (
                    <label key={tag} className={`hw-chip${on ? ' hw-chip-on' : ''}`} style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleEquipment(tag)}
                        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }}
                      />
                      {on ? '✓ ' : ''}
                      {(EQUIPMENT_LABEL.get(tag) ?? tag).toUpperCase()}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="hw-card" style={{ background: 'var(--hw-violet)', color: 'var(--hw-paper)' }}>
            <div className="hw-label">GOT SPECIFIC WEIGHTS?</div>
            <p style={{ fontSize: 12, marginTop: 8 }}>
              Tell us your actual dumbbell and plate sizes later and we&apos;ll round loads to what&apos;s on your floor.
            </p>
            <div
              style={{
                marginTop: 12,
                font: '700 11px/1 "Space Mono", monospace',
                border: '2px solid var(--hw-paper)',
                borderRadius: 999,
                padding: 11,
                textAlign: 'center',
              }}
            >
              DO IT LATER
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button type="button" onClick={() => setStep(1)} className="hw-link-back" style={{ border: 'none' }}>
              ← Back
            </button>
          </div>
          <button type="button" onClick={() => setStep(3)} className="hw-btn hw-btn-dark">
            Next — skill check
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
        <ProgressDots step={3} />
        <div className="hw-h1" style={{ fontSize: 26, marginTop: 14 }}>WHERE ARE YOU<br />ON THE BAR?</div>
        <p className="hw-lede">
          Rx is the default — only move a slider if you&apos;re not doing it as written yet. Change it the day that changes.
        </p>
      </div>

      <div className="hw-wrap" style={{ paddingTop: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SKILL_CATEGORIES.map((cat) => {
          const requiredTag = SKILL_REQUIRES_EQUIPMENT[cat.key];
          const gated = requiredTag != null && !equipment.has(requiredTag);
          const value = skillLevels[cat.key] ?? 'rx';
          return (
            <div key={cat.key} className="hw-card" style={{ opacity: gated ? 0.55 : 1 }}>
              <div className="hw-h3" style={{ fontSize: 15 }}>{cat.label.toUpperCase()}</div>
              {cat.hint && (
                <div className="hw-muted" style={{ font: '700 10px/1.5 "Space Mono", monospace', marginTop: 5 }}>
                  {cat.hint.toUpperCase()}
                </div>
              )}
              <div
                style={{
                  display: 'flex',
                  marginTop: 12,
                  border: '3px solid var(--hw-ink)',
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                {(['rx', 'intermediate', 'beginner'] as SkillLevelValue[]).map((lvl, i) => (
                  <button
                    key={lvl}
                    type="button"
                    disabled={gated}
                    onClick={() => setSkillLevels((prev) => ({ ...prev, [cat.key]: lvl }))}
                    style={{
                      flex: 1,
                      border: 'none',
                      borderLeft: i > 0 ? '3px solid var(--hw-ink)' : 'none',
                      padding: '11px 0',
                      font: '700 10px/1 "Space Mono", monospace',
                      color: 'var(--hw-ink)',
                      cursor: gated ? 'default' : 'pointer',
                      background:
                        value === lvl
                          ? lvl === 'rx'
                            ? 'var(--hw-violet)'
                            : lvl === 'intermediate'
                              ? 'var(--hw-cyan)'
                              : 'var(--hw-orange)'
                          : 'var(--hw-paper)',
                    }}
                  >
                    {lvl.slice(0, 3).toUpperCase()}
                  </button>
                ))}
              </div>
              {gated && (
                <div className="hw-error" style={{ fontSize: 10, marginTop: 10 }}>
                  NO {requiredTag!.toUpperCase()} ON YOUR GEAR LIST — SKIPPED
                </div>
              )}
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button type="button" onClick={() => setStep(2)} className="hw-link-back" style={{ border: 'none' }}>
            ← Back
          </button>
        </div>
        <button type="button" disabled={saveState === 'saving'} onClick={handleFinish} className="hw-btn hw-btn-dark">
          {saveState === 'saving' ? 'Locking in…' : 'Lock it in'}
        </button>
        {saveState === 'error' && error && <p className="hw-error" style={{ marginTop: 4 }}>{error}</p>}
      </div>
    </main>
  );
}
