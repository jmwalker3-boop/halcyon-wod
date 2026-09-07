import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LikeButton from '@/components/LikeButton';
import Avatar from '@/components/Avatar';
import TabBar from '@/components/TabBar';
import type { AthleteSkillLevel } from '@/lib/db/types';

// "The Board" (mockup screen 2c). Grouped by result_type rather than forced
// into one ranking, since the athlete picks their own scoring shape per
// entry (see components/ScoreForm.tsx) -- there's no guarantee everyone on
// the same WOD logged the same shape. Each group gets its own podium +
// ranked list + silo breakdown, since the mockup's single "board" is really
// one instance of this pattern and this page can have several.
//
// Tier filter/badges use workout_logs.result_tier (added alongside this
// rework, 20260907180000_workout_logs_result_tier.sql) -- every score
// logged before that column existed reads as 'rx' by column default, not
// because it necessarily was.
function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const TIER_LABEL: Record<AthleteSkillLevel, string> = { rx: 'RX', intermediate: 'INT', beginner: 'BEG' };
const TIER_STYLE: Record<AthleteSkillLevel, React.CSSProperties> = {
  rx: { background: 'var(--hw-violet)', color: 'var(--hw-paper)' },
  intermediate: { background: 'var(--hw-cyan)', color: 'var(--hw-ink)' },
  beginner: { background: 'var(--hw-orange)', color: 'var(--hw-ink)' },
};
const TIERS: AthleteSkillLevel[] = ['rx', 'intermediate', 'beginner'];

function TierBadge({ tier }: { tier: AthleteSkillLevel }) {
  return (
    <span
      className="hw-pill"
      style={{ ...TIER_STYLE[tier], border: '2px solid var(--hw-ink)', flex: 'none' }}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

const PODIUM_STYLE: Record<number, React.CSSProperties> = {
  0: { flex: 1.15, background: 'var(--hw-mustard)', padding: '14px 8px', order: 2 },
  1: { flex: 1, background: 'var(--hw-paper)', padding: '10px 8px', order: 1 },
  2: { flex: 1, background: 'var(--hw-orange)', padding: '8px', order: 3 },
};

function siloAverages(list: any[], scoreOf: (e: any) => number) {
  // Always computed off the unfiltered group -- the point of this card is
  // comparing silos to each other, so it shouldn't disappear or shrink to
  // one bar just because a tier filter is currently selected.
  return TIERS.map((t) => {
    const vals = list.filter((e) => e.result_tier === t).map(scoreOf);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    return { tier: t, avg };
  }).filter((r) => r.avg != null) as { tier: AthleteSkillLevel; avg: number }[];
}

// One "board" -- podium + ranked list + silo-average card -- for one
// result_type group. Hoisted to module scope (same pattern as coach/
// page.tsx's DayCard) rather than declared inside the page component, so
// it isn't redefined as a new component identity on every request.
function Board({
  title,
  list,
  allList,
  currentUserId,
  renderScore,
  renderSub,
  renderMeta,
  scoreOf,
  formatAvg,
}: {
  title: string;
  list: any[];
  allList: any[];
  currentUserId: string;
  renderScore: (e: any) => React.ReactNode;
  renderSub?: (e: any) => React.ReactNode;
  renderMeta: (logId: string) => React.ReactNode;
  scoreOf: (e: any) => number;
  formatAvg: (avg: number) => string;
}) {
  if (list.length === 0) return null;
  const podium = list.slice(0, 3);
  const rest = list.slice(3);
  const averages = siloAverages(allList, scoreOf);
  const maxAvg = Math.max(...averages.map((a) => a.avg), 1);

  return (
    <div style={{ marginTop: 16 }}>
      <span className="hw-h3">{title}</span>

      {podium.length > 0 && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
          {podium.map((e, i) => (
            <div
              key={e.id}
              style={{
                ...PODIUM_STYLE[i],
                border: '4px solid var(--hw-ink)',
                borderRadius: '14px 14px 0 0',
                textAlign: 'center',
                minWidth: 0,
              }}
            >
              <div style={{ font: `400 ${i === 0 ? 26 : 18}px/1 Bungee, sans-serif`, color: 'var(--hw-ink)' }}>{i + 1}</div>
              <div className="hw-muted" style={{ font: '700 10px/1.4 "Space Mono", monospace', color: 'var(--hw-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {e.profiles?.display_name ?? 'Athlete'}
              </div>
              <div style={{ font: `700 ${i === 0 ? 15 : 13}px/1.3 "Space Mono", monospace`, color: 'var(--hw-ink)' }}>
                {renderScore(e)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="hw-card"
        style={{
          marginTop: podium.length > 0 ? 0 : 10,
          borderRadius: podium.length > 0 ? '0 0 16px 16px' : 16,
          borderTop: podium.length > 0 ? 'none' : undefined,
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {(podium.length > 0 ? rest : list).map((e, i) => {
          const rank = podium.length > 0 ? i + 4 : i + 1;
          return (
            <div
              key={e.id}
              style={{
                padding: '12px 14px',
                borderBottom: '2px solid var(--hw-ink)',
                borderBottomWidth: (podium.length > 0 ? i === rest.length - 1 : i === list.length - 1) ? 0 : 2,
                opacity: 0.85,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="hw-muted" style={{ font: '700 13px/1 "Space Mono", monospace', width: 22, flex: 'none' }}>
                  {rank}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ font: '700 13px/1.3 "Space Grotesk", sans-serif', display: 'flex', alignItems: 'center' }}>
                    <Avatar name={e.profiles?.display_name ?? 'Athlete'} url={e.profiles?.avatar_url ?? null} />
                    {e.profile_id === currentUserId ? 'You' : e.profiles?.display_name ?? 'Athlete'}
                  </div>
                  {renderSub && (
                    <div className="hw-muted" style={{ font: '400 9px/1.4 "Space Mono", monospace', marginTop: 2 }}>
                      {renderSub(e)}
                    </div>
                  )}
                </div>
                <TierBadge tier={e.result_tier} />
                <span style={{ font: '700 15px/1 "Space Mono", monospace', width: 56, textAlign: 'right', flex: 'none' }}>
                  {renderScore(e)}
                </span>
              </div>
              {renderMeta(e.id)}
            </div>
          );
        })}
      </div>

      {averages.length > 0 && (
        <div className="hw-card" style={{ marginTop: 10, background: 'var(--hw-violet)', color: 'var(--hw-paper)' }}>
          <div className="hw-label">SILO AVERAGES</div>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            {averages.map(({ tier, avg }) => (
              <div key={tier} style={{ flex: 1 }}>
                <div
                  style={{
                    height: 8,
                    borderRadius: 999,
                    background: TIER_STYLE[tier].background,
                    width: `${Math.max(20, (avg / maxAvg) * 100)}%`,
                  }}
                />
                <div style={{ font: '700 10px/1.8 "Space Mono", monospace' }}>
                  {TIER_LABEL[tier]} {formatAvg(avg)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default async function LeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ workoutId: string }>;
  searchParams: Promise<{ tier?: string }>;
}) {
  const { workoutId } = await params;
  const { tier: tierFilterRaw } = await searchParams;
  const tierFilter = TIERS.includes(tierFilterRaw as AthleteSkillLevel) ? (tierFilterRaw as AthleteSkillLevel) : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: workout } = await supabase.from('workouts').select('title, raw_text').eq('id', workoutId).single();

  const { data: logs } = await supabase
    .from('workout_logs')
    .select(
      'id, profile_id, result_type, result_value, result_tier, rpe, performed_at, movement_id, profiles ( display_name, avatar_url ), movements ( canonical_name )',
    )
    .eq('workout_id', workoutId)
    .order('performed_at', { ascending: true });

  const logIds = (logs ?? []).map((l: any) => l.id);

  const [{ data: posts }, { data: reactionRows }] = await Promise.all([
    logIds.length
      ? supabase.from('posts').select('id, body, workout_log_id').in('workout_log_id', logIds)
      : Promise.resolve({ data: [] as any[] }),
    // Keyed on workout_log_id, not post_id -- a shaka needs to work on every
    // entry, and ScoreForm's comment is optional, so a post doesn't always
    // exist (John's report, 2026-09-07: no way to like a score with no
    // comment attached).
    logIds.length
      ? supabase.from('reactions').select('workout_log_id, profile_id').in('workout_log_id', logIds).eq('type', 'like')
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const postByLogId = new Map((posts ?? []).map((p: any) => [p.workout_log_id, p]));
  const likeCountByLog = new Map<string, number>();
  const likedByMeByLog = new Set<string>();
  for (const r of (reactionRows ?? []) as any[]) {
    likeCountByLog.set(r.workout_log_id, (likeCountByLog.get(r.workout_log_id) ?? 0) + 1);
    if (r.profile_id === user.id) likedByMeByLog.add(r.workout_log_id);
  }

  const allEntries = (logs ?? []) as any[];
  const entries = tierFilter ? allEntries.filter((e) => e.result_tier === tierFilter) : allEntries;

  const timeEntriesAll = allEntries.filter((e) => e.result_type === 'time').sort((a, b) => a.result_value.seconds - b.result_value.seconds);
  const timeEntries = tierFilter ? timeEntriesAll.filter((e) => e.result_tier === tierFilter) : timeEntriesAll;

  const roundsRepsScore = (e: any) => e.result_value.rounds * 1000 + e.result_value.reps;
  const roundsRepsEntriesAll = allEntries
    .filter((e) => e.result_type === 'rounds_reps')
    .sort((a, b) => roundsRepsScore(b) - roundsRepsScore(a));
  const roundsRepsEntries = tierFilter ? roundsRepsEntriesAll.filter((e) => e.result_tier === tierFilter) : roundsRepsEntriesAll;

  const loadEntriesByMovementAll = new Map<string, any[]>();
  for (const e of allEntries.filter((e) => e.result_type === 'load')) {
    const key = e.movements?.canonical_name ?? 'Unknown movement';
    const list = loadEntriesByMovementAll.get(key) ?? [];
    list.push(e);
    loadEntriesByMovementAll.set(key, list);
  }
  for (const list of loadEntriesByMovementAll.values()) {
    list.sort((a, b) => b.result_value.weight - a.result_value.weight);
  }

  function renderMeta(logId: string) {
    const post = postByLogId.get(logId);
    const count = likeCountByLog.get(logId) ?? 0;
    const liked = likedByMeByLog.has(logId);
    return (
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
        {post ? (
          <p className="hw-muted" style={{ fontSize: 12, margin: 0, flex: 1 }}>&ldquo;{post.body}&rdquo;</p>
        ) : (
          <span style={{ flex: 1 }} />
        )}
        <LikeButton workoutLogId={logId} initialLiked={liked} initialCount={count} />
      </div>
    );
  }

  // "You're Nth of M" (mockup's yellow banner) -- against whatever board is
  // currently visible (the tier filter applied), for whichever group the
  // athlete actually has an entry in. Time and rounds+reps only: a "load"
  // board is per-movement, not a single ranking an athlete has one spot in.
  const myRankCard = (() => {
    for (const list of [timeEntries, roundsRepsEntries]) {
      const myIndex = list.findIndex((e) => e.profile_id === user.id);
      if (myIndex >= 0) return { place: myIndex + 1, of: list.length };
    }
    return null;
  })();

  return (
    <main className="hw-shell">
      <div className="hw-wrap" style={{ paddingBottom: 100 }}>
        <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
        <div className="hw-h1" style={{ fontSize: 26 }}>{workout?.title ?? 'THE BOARD'}</div>
        <span className="hw-eyebrow" style={{ marginTop: 10, display: 'inline-block' }}>
          {allEntries.length} SCORE{allEntries.length === 1 ? '' : 'S'} IN
        </span>
        {workout?.raw_text && (
          <pre style={{ whiteSpace: 'pre-wrap', font: '700 11px/1.6 "Space Mono", monospace', marginTop: 12 }}>
            {workout.raw_text}
          </pre>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <Link
            href={`/leaderboard/${workoutId}`}
            className="hw-pill"
            style={!tierFilter ? { background: 'var(--hw-ink)', color: 'var(--hw-mustard)' } : { background: 'var(--hw-paper)', color: 'var(--hw-ink)', border: '2px solid var(--hw-ink)' }}
          >
            ALL SILOS
          </Link>
          {TIERS.map((t) => (
            <Link
              key={t}
              href={`/leaderboard/${workoutId}?tier=${t}`}
              className="hw-pill"
              style={tierFilter === t ? { background: 'var(--hw-ink)', color: 'var(--hw-mustard)' } : { background: 'var(--hw-paper)', color: 'var(--hw-ink)', border: '2px solid var(--hw-ink)' }}
            >
              {TIER_LABEL[t]}
            </Link>
          ))}
        </div>

        {entries.length === 0 && (
          <div className="hw-card" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>No scores logged yet{tierFilter ? ' in this silo.' : '.'}</p>
          </div>
        )}

        <Board
          title="For Time"
          list={timeEntries}
          allList={timeEntriesAll}
          currentUserId={user.id}
          renderMeta={renderMeta}
          scoreOf={(e) => e.result_value.seconds}
          formatAvg={(avg) => formatTime(Math.round(avg))}
          renderScore={(e) => `${formatTime(e.result_value.seconds)}${e.rpe ? ` · RPE ${e.rpe}` : ''}`}
        />

        <Board
          title="Rounds + Reps"
          list={roundsRepsEntries}
          allList={roundsRepsEntriesAll}
          currentUserId={user.id}
          renderMeta={renderMeta}
          scoreOf={roundsRepsScore}
          formatAvg={(avg) => `${Math.floor(avg / 1000)}+${Math.round(avg % 1000)}`}
          renderScore={(e) => `${e.result_value.rounds}+${e.result_value.reps}`}
        />

        {[...loadEntriesByMovementAll.entries()].map(([movementName, allList]) => {
          const list = tierFilter ? allList.filter((e) => e.result_tier === tierFilter) : allList;
          return (
            <Board
              key={movementName}
              title={movementName}
              list={list}
              allList={allList}
              currentUserId={user.id}
              renderMeta={renderMeta}
              scoreOf={(e) => e.result_value.weight}
              formatAvg={(avg) => `${Math.round(avg)} lb`}
              renderSub={(e) => `${e.result_value.reps} × ${e.result_value.sets} sets`}
              renderScore={(e) => `${e.result_value.weight} lb`}
            />
          );
        })}

        {myRankCard && (
          <div className="hw-card" style={{ marginTop: 14, background: 'var(--hw-mustard)', display: 'flex', gap: 12, alignItems: 'center' }}>
            <div
              style={{
                width: 48,
                height: 48,
                flex: 'none',
                borderRadius: '50%',
                border: '3px solid var(--hw-ink)',
                background: 'var(--hw-paper)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                font: '700 15px/1 "Space Mono", monospace',
              }}
            >
              {myRankCard.place}
            </div>
            <p style={{ margin: 0, fontSize: 13 }}>
              You&apos;re {myRankCard.place} of {myRankCard.of}
              {tierFilter ? ` in ${TIER_LABEL[tierFilter]}` : ''}.
            </p>
          </div>
        )}
      </div>
      <TabBar boardHref={`/leaderboard/${workoutId}`} />
    </main>
  );
}
