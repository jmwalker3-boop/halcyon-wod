'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// Athlete-facing settings, added 2026-09-04 per John's request: a real place
// to record equipment and gymnastics skill level, instead of those only
// being read passively by /dashboard. Client-side and self-contained (same
// pattern as app/login/page.tsx) -- writes go straight through the
// browser's RLS-scoped Supabase client to profile_equipment and
// profile_skill_levels, both of which already have "insert/update/delete
// own" policies (20260903160000_profile_equipment.sql,
// 20260904120000_skill_levels_and_equipment_substitutes.sql). No API route
// needed for either.
//
// Equipment is saved as a full replace (delete everything, then insert what's
// checked) rather than a diff -- simplest correct semantics for a checkbox
// form, and profile_equipment has no other columns worth preserving per row
// today (just equipment_tag). Skill levels are upserted one row per category
// via onConflict, since profile_skill_levels has a real unique constraint
// (profile_id, skill_category) to upsert against.
//
// Deliberately doesn't include profile_equipment_loads (specific owned
// weights) -- John asked for "select what equipment you have," which this
// covers; entering exact plate/dumbbell weights is a reasonable follow-up
// but a separate, more involved UI (numeric inputs per class, not a
// checkbox), not built here.

const EQUIPMENT_OPTIONS: { tag: string; label: string }[] = [
  { tag: 'barbell', label: 'Barbell' },
  { tag: 'plate', label: 'Plates' },
  { tag: 'dumbbell', label: 'Dumbbells' },
  { tag: 'kettlebell', label: 'Kettlebell' },
  { tag: 'pull-up bar', label: 'Pull-up bar' },
  { tag: 'rings', label: 'Rings' },
  { tag: 'box', label: 'Plyo box' },
  { tag: 'bench', label: 'Bench' },
  { tag: 'band', label: 'Resistance band' },
  { tag: 'wall', label: 'Wall space (for wall balls / HSPU / handstand work)' },
  { tag: 'rope', label: 'Climbing rope' },
  { tag: 'jump rope', label: 'Jump rope' },
  { tag: 'med ball', label: 'Medicine ball' },
  { tag: 'sandbag', label: 'Sandbag' },
  { tag: 'ghd', label: 'GHD machine' },
  { tag: 'bike', label: 'Bike (Echo/Assault-style)' },
  { tag: 'bike erg', label: 'Bike erg' },
  { tag: 'rower', label: 'Rower' },
  { tag: 'ski erg', label: 'Ski erg' },
  { tag: 'cable', label: 'Cable machine' },
  { tag: 'pvc', label: 'PVC pipe' },
];

type SkillCategoryKey = 'pull_up_bar' | 'rings' | 'handstand' | 'hanging_core' | 'rope_climb' | 'pistol';
type SkillLevelValue = 'rx' | 'intermediate' | 'beginner';

const SKILL_CATEGORIES: { key: SkillCategoryKey; label: string; hint: string }[] = [
  { key: 'pull_up_bar', label: 'Pull-up bar', hint: 'Pull-ups, chest-to-bar, muscle-ups' },
  { key: 'rings', label: 'Rings', hint: 'Ring rows/dips, ring muscle-ups, toes-to-rings' },
  { key: 'handstand', label: 'Handstand', hint: 'HSPU, handstand walk, wall walks' },
  { key: 'hanging_core', label: 'Toes-to-bar / hanging core', hint: 'Toes-to-bar, knees-to-elbows' },
  { key: 'rope_climb', label: 'Rope climb', hint: '' },
  { key: 'pistol', label: 'Pistols (single-leg squat)', hint: '' },
];

const LEVELS: { value: string; label: string }[] = [
  { value: 'rx', label: 'Rx -- do it as written' },
  { value: 'intermediate', label: 'Intermediate scale' },
  { value: 'beginner', label: 'Beginner scale' },
];

type LoadState = 'loading' | 'ready' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function SettingsPage() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [equipment, setEquipment] = useState<Set<string>>(new Set());
  const [skillLevels, setSkillLevels] = useState<Record<string, SkillLevelValue>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('Not signed in.');
        setLoadState('error');
        return;
      }

      const [{ data: equipmentRows, error: equipmentError }, { data: skillRows, error: skillError }] = await Promise.all([
        supabase.from('profile_equipment').select('equipment_tag').eq('profile_id', user.id),
        supabase.from('profile_skill_levels').select('skill_category, level').eq('profile_id', user.id),
      ]);

      if (equipmentError || skillError) {
        setError((equipmentError ?? skillError)!.message);
        setLoadState('error');
        return;
      }

      setEquipment(new Set((equipmentRows ?? []).map((r: any) => r.equipment_tag)));
      setSkillLevels(Object.fromEntries((skillRows ?? []).map((r: any) => [r.skill_category, r.level])));
      setLoadState('ready');
    })();
  }, []);

  function toggleEquipment(tag: string) {
    setEquipment((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveState('saving');
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('Not signed in.');
      setSaveState('error');
      return;
    }

    // Equipment: full replace. Two round trips (delete, then insert) rather
    // than a diff -- simpler and correct for a checkbox-set form; this table
    // has no other per-row data worth preserving.
    const { error: deleteError } = await supabase.from('profile_equipment').delete().eq('profile_id', user.id);
    if (deleteError) {
      setError(deleteError.message);
      setSaveState('error');
      return;
    }
    if (equipment.size > 0) {
      const { error: insertError } = await supabase
        .from('profile_equipment')
        .insert([...equipment].map((equipment_tag) => ({ profile_id: user.id, equipment_tag })));
      if (insertError) {
        setError(insertError.message);
        setSaveState('error');
        return;
      }
    }

    // Skill levels: upsert one row per category that has a non-default
    // value recorded. Categories left at 'rx' just don't get a row --
    // resolveMovementForAthlete already treats "no row" as rx.
    const skillRowsToSave = SKILL_CATEGORIES.filter((c) => skillLevels[c.key] && skillLevels[c.key] !== 'rx').map((c) => ({
      profile_id: user.id,
      skill_category: c.key,
      level: skillLevels[c.key] as SkillLevelValue,
      updated_at: new Date().toISOString(),
    }));
    const rxCategories: SkillCategoryKey[] = SKILL_CATEGORIES.filter(
      (c) => !skillLevels[c.key] || skillLevels[c.key] === 'rx',
    ).map((c) => c.key);

    const [{ error: upsertError }, { error: deleteRxError }] = await Promise.all([
      skillRowsToSave.length > 0
        ? supabase.from('profile_skill_levels').upsert(skillRowsToSave, { onConflict: 'profile_id,skill_category' })
        : Promise.resolve({ error: null }),
      rxCategories.length > 0
        ? supabase.from('profile_skill_levels').delete().eq('profile_id', user.id).in('skill_category', rxCategories)
        : Promise.resolve({ error: null }),
    ]);
    if (upsertError || deleteRxError) {
      setError((upsertError ?? deleteRxError)!.message);
      setSaveState('error');
      return;
    }

    setSaveState('saved');
  }

  if (loadState === 'loading') {
    return (
      <main className="container">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  if (loadState === 'error') {
    return (
      <main className="container">
        <p style={{ color: '#e07a7a' }}>{error}</p>
      </main>
    );
  }

  return (
    <main className="container">
      <p>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>
      <h1>Settings</h1>

      <form onSubmit={handleSave}>
        <div className="card">
          <h2>Your equipment</h2>
          <p className="muted">
            Check what you actually have. Your workouts will show a scaled version automatically for anything you're
            missing, where one exists.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0.4rem' }}>
            {EQUIPMENT_OPTIONS.map((opt) => (
              <label key={opt.tag} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto', margin: 0 }}
                  checked={equipment.has(opt.tag)}
                  onChange={() => toggleEquipment(opt.tag)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <h2>Gymnastics skill level</h2>
          <p className="muted">
            Set this for anything you're not doing Rx yet. Leave it at Rx for skills you've got -- that's the default.
          </p>
          {SKILL_CATEGORIES.map((cat) => (
            <div key={cat.key} style={{ marginBottom: '0.9rem' }}>
              <label style={{ display: 'block', marginBottom: '0.25rem' }}>
                {cat.label}
                {cat.hint && <span className="muted"> — {cat.hint}</span>}
              </label>
              <select
                value={skillLevels[cat.key] ?? 'rx'}
                onChange={(e) => setSkillLevels((prev) => ({ ...prev, [cat.key]: e.target.value as SkillLevelValue }))}
                style={{
                  width: '100%',
                  padding: '0.5rem 0.6rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--fg)',
                }}
              >
                {LEVELS.map((lvl) => (
                  <option key={lvl.value} value={lvl.value}>
                    {lvl.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <button type="submit" disabled={saveState === 'saving'}>
          {saveState === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {saveState === 'saved' && <p style={{ color: '#7ac98a' }}>Saved.</p>}
        {saveState === 'error' && error && <p style={{ color: '#e07a7a' }}>{error}</p>}
      </form>
    </main>
  );
}
