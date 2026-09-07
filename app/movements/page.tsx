import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { AthleteSkillLevel, Modality, SkillCategory } from '@/lib/db/types';
import { checkEquipmentGap, normalizeEquipmentTag } from '@blackboxmethod/equipment-resolver';

// Mockup screen 2e ("The Moves"). Personalized 2026-09-07 alongside the
// leaderboard/dashboard mockup pass -- previously this was a flat,
// un-personalized catalog (same RLS posture as dashboard/page.tsx's
// comment on `movements`: any signed-in athlete can read the whole table).
// Equipment-gap checking reuses checkEquipmentGap from the same resolver
// package /dashboard uses, rather than re-implementing tag matching here.
// Deliberately lighter than the full resolveMovementForAthlete pass
// though: this page shows the RX/INT/BEG *ladder* for a skill category (so
// an athlete can see where they'd land if they moved a slider), not a
// live "what would today's WOD look like" resolution -- that's what
// /dashboard is for.

const MODALITY_LABEL: Record<Modality, string> = { M: 'Monostructural', G: 'Gymnastics', W: 'Weightlifting' };
const MODALITY_HEADER: Record<Modality, string> = { M: 'var(--hw-navy)', G: 'var(--hw-mustard)', W: 'var(--hw-pink)' };
const MODALITY_HEADER_TEXT: Record<Modality, string> = { M: 'var(--hw-mustard)', G: 'var(--hw-ink)', W: 'var(--hw-paper)' };
const SKILL_LABEL: Record<SkillCategory, string> = {
  pull_up_bar: 'Pull-up Bar',
  rings: 'Rings',
  handstand: 'Handstand',
  hanging_core: 'Hanging Core',
  rope_climb: 'Rope Climb',
  pistol: 'Pistol',
};
const TIER_BADGE: Record<AthleteSkillLevel, { bg: string; color: string; label: string }> = {
  rx: { bg: 'var(--hw-violet)', color: 'var(--hw-paper)', label: 'RX' },
  intermediate: { bg: 'var(--hw-cyan)', color: 'var(--hw-ink)', label: 'INT' },
  beginner: { bg: 'var(--hw-orange)', color: 'var(--hw-ink)', label: 'BEG' },
};

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; modality?: string; gear?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { q = '', modality: modalityFilter = '', gear: gearFilter = '' } = await searchParams;

  const [
    { data: movements },
    { data: ownedTagRows },
    { data: skillLevelRows },
    { data: movementScaleRows },
    { data: equipmentSubstituteRows },
  ] = await Promise.all([
    supabase.from('movements').select('id, canonical_name, modality, equipment, skill_category').order('canonical_name'),
    supabase.from('profile_equipment').select('equipment_tag').eq('profile_id', user.id),
    supabase.from('profile_skill_levels').select('skill_category, level').eq('profile_id', user.id),
    supabase.from('movement_scales').select('movement_id, tier, scale_movement_id'),
    supabase.from('movement_equipment_substitutes').select('movement_id, substitute_id'),
  ]);

  const hasRecordedEquipment = (ownedTagRows?.length ?? 0) > 0;
  const ownedTags = new Set((ownedTagRows ?? []).map((r: any) => normalizeEquipmentTag(r.equipment_tag)));
  const skillLevels = new Map<SkillCategory, AthleteSkillLevel>(
    (skillLevelRows ?? []).map((r: any) => [r.skill_category as SkillCategory, r.level as AthleteSkillLevel]),
  );
  const nameById = new Map((movements ?? []).map((m: any) => [m.id, m.canonical_name as string]));
  const skillLadderByMovementId = new Map<string, Partial<Record<AthleteSkillLevel, string>>>();
  for (const row of (movementScaleRows ?? []) as any[]) {
    const scaleName = nameById.get(row.scale_movement_id);
    if (!scaleName) continue;
    const entry = skillLadderByMovementId.get(row.movement_id) ?? {};
    entry[row.tier as AthleteSkillLevel] = scaleName;
    skillLadderByMovementId.set(row.movement_id, entry);
  }
  const equipmentSubByMovementId = new Map<string, string>();
  for (const row of (equipmentSubstituteRows ?? []) as any[]) {
    const subName = nameById.get(row.substitute_id);
    if (subName) equipmentSubByMovementId.set(row.movement_id, subName);
  }

  function gapFor(m: { canonical_name: string; equipment: string[] }) {
    return checkEquipmentGap(m.canonical_name, m.equipment ?? [], ownedTags);
  }

  const filtered = (movements ?? []).filter((m) => {
    if (modalityFilter && m.modality !== modalityFilter) return false;
    if (q && !m.canonical_name.toLowerCase().includes(q.toLowerCase())) return false;
    if (gearFilter === 'mine' && hasRecordedEquipment && !gapFor(m).ok) return false;
    return true;
  });

  const modalities: Modality[] = ['M', 'G', 'W'];

  // "MISSING GEAR" summary (mockup's bottom card) -- computed across the
  // WHOLE catalog, not just the current filter, so it stays a stable "here's
  // what's holding you back overall" rather than shifting with the search box.
  const missingAcrossCatalog = (() => {
    if (!hasRecordedEquipment) return null;
    const missingTags = new Set<string>();
    let affectedCount = 0;
    for (const m of movements ?? []) {
      const gap = gapFor(m);
      if (!gap.ok) {
        affectedCount += 1;
        for (const tag of gap.missingEquipment) missingTags.add(tag);
      }
    }
    if (affectedCount === 0) return null;
    return { missingTags: [...missingTags], affectedCount };
  })();

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
        <div className="hw-eyebrow-row">
          <span className="hw-eyebrow">Movement Library</span>
          <Link href="/dashboard" className="hw-link-back">Back</Link>
        </div>
        <div className="hw-h1" style={{ fontSize: 28 }}>THE MOVES</div>
        <p className="hw-lede">{filtered.length} of {movements?.length ?? 0} movements</p>

        <form method="get" style={{ marginTop: 16 }}>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder={`Search ${movements?.length ?? 0} movements…`}
            style={{
              width: '100%',
              font: '700 13px/1 "Space Grotesk", sans-serif',
              padding: '14px 16px',
              border: '4px solid var(--hw-ink)',
              borderRadius: 999,
              background: 'var(--hw-paper)',
              color: 'var(--hw-ink)',
              boxShadow: '4px 4px 0 var(--hw-ink)',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="submit"
              name="modality"
              value=""
              className={`hw-chip${!modalityFilter ? ' hw-chip-on' : ''}`}
            >
              ALL
            </button>
            {modalities.map((m) => (
              <button key={m} type="submit" name="modality" value={m} className={`hw-chip${modalityFilter === m ? ' hw-chip-on' : ''}`}>
                {m}
              </button>
            ))}
            {hasRecordedEquipment && (
              <button
                type="submit"
                name="gear"
                value={gearFilter === 'mine' ? '' : 'mine'}
                className={`hw-chip${gearFilter === 'mine' ? ' hw-chip-on' : ''}`}
              >
                MY GEAR
              </button>
            )}
          </div>
        </form>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.length === 0 && (
            <div className="hw-card">
              <p className="hw-muted" style={{ margin: 0 }}>No movements match that search.</p>
            </div>
          )}

          {filtered.map((m) => {
            const gap = hasRecordedEquipment ? gapFor(m) : null;
            const ladder = m.skill_category ? skillLadderByMovementId.get(m.id) : undefined;
            const currentLevel = m.skill_category ? skillLevels.get(m.skill_category) ?? 'rx' : null;
            const equipmentSub = !m.skill_category ? equipmentSubByMovementId.get(m.id) : undefined;

            return (
              <div key={m.id} className="hw-card" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  style={{
                    padding: '12px 14px',
                    background: MODALITY_HEADER[m.modality],
                    borderBottom: '4px solid var(--hw-ink)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span className="hw-h3" style={{ fontSize: 16, color: MODALITY_HEADER_TEXT[m.modality] }}>{m.canonical_name.toUpperCase()}</span>
                  <span className="hw-pill hw-pill-dark">{gap && !gap.ok ? 'NO GEAR' : m.modality}</span>
                </div>
                <div style={{ padding: 14 }}>
                  <div
                    className="hw-label"
                    style={{ color: gap && !gap.ok ? 'var(--hw-pink-deep)' : undefined, opacity: gap && !gap.ok ? 1 : 0.6 }}
                  >
                    NEEDS · {(m.equipment ?? []).length ? m.equipment.join(', ').toUpperCase() : 'BODYWEIGHT'}
                    {gap && (gap.ok ? ' · YOU HAVE IT' : ` · NOT ON YOUR LIST`)}
                  </div>

                  {ladder && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(['rx', 'intermediate', 'beginner'] as AthleteSkillLevel[]).map((tier) => {
                        const name = tier === 'rx' ? m.canonical_name : ladder[tier];
                        if (!name) return null;
                        const badge = TIER_BADGE[tier];
                        return (
                          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span
                              className="hw-pill"
                              style={{ background: badge.bg, color: badge.color, width: 42, justifyContent: 'center', flex: 'none' }}
                            >
                              {badge.label}
                            </span>
                            <span style={{ font: '700 12px/1.3 "Space Grotesk", sans-serif' }}>
                              {name}
                              {currentLevel === tier && <span className="hw-muted" style={{ fontWeight: 400 }}> ← you</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {equipmentSub && (
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span className="hw-pill hw-pill-cyan">{equipmentSub.toUpperCase()} SUB</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {missingAcrossCatalog && (
          <div className="hw-card" style={{ marginTop: 14, background: 'var(--hw-violet)', color: 'var(--hw-paper)' }}>
            <span className="hw-label">MISSING GEAR</span>
            <p style={{ fontSize: 13, marginTop: 8 }}>
              {missingAcrossCatalog.missingTags.join(', ')} {missingAcrossCatalog.missingTags.length === 1 ? "isn't" : "aren't"} on your list.{' '}
              {missingAcrossCatalog.affectedCount} movement{missingAcrossCatalog.affectedCount === 1 ? '' : 's'} in the catalog need
              {missingAcrossCatalog.affectedCount === 1 ? 's' : ''} a manual scale because of it.
            </p>
            <Link href="/account" className="hw-btn hw-btn-mustard" style={{ marginTop: 12, fontSize: 14, padding: 12 }}>
              Fix my gear list →
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
