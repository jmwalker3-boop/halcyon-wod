import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Modality } from '@/lib/db/types';

// Mockup screen 2e ("The Moves"). Per-athlete personalization (gear gaps,
// current skill level) removed (John's call, 2026-09-29): Rx / Scaled /
// Minimal on /wod replaces per-athlete resolution with fixed, pre-authored
// workout variants, so there's no athlete profile left to resolve against.
// What's still shown -- what a movement needs, and the intermediate/
// beginner scale or equipment sub already on file for it -- is reference
// data, not personalized to any one athlete.

const MODALITY_HEADER: Record<Modality, string> = { M: 'var(--hw-navy)', G: 'var(--hw-mustard)', W: 'var(--hw-pink)' };
const MODALITY_HEADER_TEXT: Record<Modality, string> = { M: 'var(--hw-mustard)', G: 'var(--hw-ink)', W: 'var(--hw-paper)' };

export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; modality?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { q = '', modality: modalityFilter = '' } = await searchParams;

  const [{ data: movements }, { data: movementScaleRows }, { data: equipmentSubstituteRows }] = await Promise.all([
    supabase.from('movements').select('id, canonical_name, modality, equipment, skill_category').order('canonical_name'),
    supabase.from('movement_scales').select('movement_id, tier, scale_movement_id'),
    supabase.from('movement_equipment_substitutes').select('movement_id, substitute_id'),
  ]);

  const nameById = new Map((movements ?? []).map((m: any) => [m.id, m.canonical_name as string]));
  const scaleByMovementId = new Map<string, { intermediate?: string; beginner?: string }>();
  for (const row of (movementScaleRows ?? []) as any[]) {
    const scaleName = nameById.get(row.scale_movement_id);
    if (!scaleName) continue;
    const entry = scaleByMovementId.get(row.movement_id) ?? {};
    entry[row.tier as 'intermediate' | 'beginner'] = scaleName;
    scaleByMovementId.set(row.movement_id, entry);
  }
  const equipmentSubByMovementId = new Map<string, string>();
  for (const row of (equipmentSubstituteRows ?? []) as any[]) {
    const subName = nameById.get(row.substitute_id);
    if (subName) equipmentSubByMovementId.set(row.movement_id, subName);
  }

  const filtered = (movements ?? []).filter((m) => {
    if (modalityFilter && m.modality !== modalityFilter) return false;
    if (q && !m.canonical_name.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const modalities: Modality[] = ['M', 'G', 'W'];

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
          </div>
        </form>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.length === 0 && (
            <div className="hw-card">
              <p className="hw-muted" style={{ margin: 0 }}>No movements match that search.</p>
            </div>
          )}

          {filtered.map((m) => {
            const scale = scaleByMovementId.get(m.id);
            const equipmentSub = equipmentSubByMovementId.get(m.id);

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
                  <span className="hw-pill hw-pill-dark">{m.modality}</span>
                </div>
                <div style={{ padding: 14 }}>
                  <div className="hw-label" style={{ opacity: 0.6 }}>
                    NEEDS · {(m.equipment ?? []).length ? m.equipment.join(', ').toUpperCase() : 'BODYWEIGHT'}
                  </div>

                  {(scale?.intermediate || scale?.beginner) && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {scale.intermediate && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="hw-pill" style={{ background: 'var(--hw-cyan)', color: 'var(--hw-ink)', width: 42, justifyContent: 'center', flex: 'none' }}>INT</span>
                          <span style={{ font: '700 12px/1.3 "Space Grotesk", sans-serif' }}>{scale.intermediate}</span>
                        </div>
                      )}
                      {scale.beginner && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span className="hw-pill" style={{ background: 'var(--hw-orange)', color: 'var(--hw-ink)', width: 42, justifyContent: 'center', flex: 'none' }}>BEG</span>
                          <span style={{ font: '700 12px/1.3 "Space Grotesk", sans-serif' }}>{scale.beginner}</span>
                        </div>
                      )}
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
      </div>
    </main>
  );
}
