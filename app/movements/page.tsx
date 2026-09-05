import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import type { Modality, SkillCategory } from '@/lib/db/types';

// Read-only v0 of mockup screen 2e (Movement Library). Same RLS posture as
// the rest of the movement catalog (dashboard/page.tsx's comment on
// `movements`): any signed-in athlete can read the full table, so this is
// a flat fetch + client-side grouping, no per-athlete resolution at all --
// unlike /dashboard, this page doesn't personalize by equipment/skill, it's
// just the reference catalog.

const MODALITY_LABEL: Record<Modality, string> = { M: 'Monostructural', G: 'Gymnastics', W: 'Weightlifting' };
const SKILL_LABEL: Record<SkillCategory, string> = {
  pull_up_bar: 'Pull-up Bar',
  rings: 'Rings',
  handstand: 'Handstand',
  hanging_core: 'Hanging Core',
  rope_climb: 'Rope Climb',
  pistol: 'Pistol',
};

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

  const { data: movements } = await supabase
    .from('movements')
    .select('id, canonical_name, modality, equipment, skill_category')
    .order('canonical_name');

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
        <div className="hw-h1" style={{ fontSize: 26, color: 'var(--hw-ink)', textShadow: 'none' }}>
          The Catalog
        </div>
        <p className="hw-lede">{filtered.length} of {movements?.length ?? 0} movements</p>

        <form method="get" style={{ marginTop: 16 }}>
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search movements…"
            style={{
              width: '100%',
              font: '700 13px/1 "Space Grotesk", sans-serif',
              padding: '14px 16px',
              border: '3px solid var(--hw-ink)',
              borderRadius: 999,
              background: 'var(--hw-paper)',
              color: 'var(--hw-ink)',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button
              type="submit"
              name="modality"
              value=""
              className={`hw-chip${!modalityFilter ? ' hw-chip-on' : ''}`}
              style={{ border: '2px solid var(--hw-ink)' }}
            >
              All
            </button>
            {modalities.map((m) => (
              <button
                key={m}
                type="submit"
                name="modality"
                value={m}
                className={`hw-chip${modalityFilter === m ? ' hw-chip-on' : ''}`}
              >
                {MODALITY_LABEL[m]}
              </button>
            ))}
          </div>
        </form>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.length === 0 && (
            <div className="hw-card">
              <p className="hw-muted" style={{ margin: 0 }}>No movements match that search.</p>
            </div>
          )}

          {filtered.map((m) => (
            <div key={m.id} className="hw-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div className="hw-h3" style={{ fontSize: 15 }}>{m.canonical_name}</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="hw-pill hw-pill-cyan">{MODALITY_LABEL[m.modality]}</span>
                  {m.skill_category && (
                    <span className="hw-pill hw-pill-mustard">{SKILL_LABEL[m.skill_category]}</span>
                  )}
                  {(m.equipment ?? []).map((tag) => (
                    <span key={tag} className="hw-pill hw-pill-outline">{tag}</span>
                  ))}
                  {(m.equipment ?? []).length === 0 && (
                    <span className="hw-pill hw-pill-outline">Bodyweight</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

