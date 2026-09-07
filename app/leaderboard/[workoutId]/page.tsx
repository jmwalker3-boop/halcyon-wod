import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import LikeButton from '@/components/LikeButton';
import Avatar from '@/components/Avatar';

// One WOD's scores across everyone (workout_logs: enrolled read, added
// 2026-09-07 alongside this page -- previously an athlete could only read
// their own row, which made a leaderboard impossible). Grouped by
// result_type rather than forced into one ranking, since the athlete
// picks their own scoring shape per entry (see components/ScoreForm.tsx) --
// there's no guarantee everyone on the same WOD logged the same shape.
function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default async function LeaderboardPage({ params }: { params: Promise<{ workoutId: string }> }) {
  const { workoutId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: workout } = await supabase.from('workouts').select('title, raw_text').eq('id', workoutId).single();

  const { data: logs } = await supabase
    .from('workout_logs')
    .select('id, profile_id, result_type, result_value, rpe, performed_at, movement_id, profiles ( display_name, avatar_url ), movements ( canonical_name )')
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

  const entries = (logs ?? []) as any[];
  const timeEntries = entries.filter((e) => e.result_type === 'time').sort((a, b) => a.result_value.seconds - b.result_value.seconds);
  const roundsRepsEntries = entries
    .filter((e) => e.result_type === 'rounds_reps')
    .sort((a, b) => (b.result_value.rounds * 1000 + b.result_value.reps) - (a.result_value.rounds * 1000 + a.result_value.reps));
  const loadEntriesByMovement = new Map<string, any[]>();
  for (const e of entries.filter((e) => e.result_type === 'load')) {
    const key = e.movements?.canonical_name ?? 'Unknown movement';
    const list = loadEntriesByMovement.get(key) ?? [];
    list.push(e);
    loadEntriesByMovement.set(key, list);
  }
  for (const list of loadEntriesByMovement.values()) {
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

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
        <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
        <div className="hw-h1" style={{ fontSize: 24 }}>{workout?.title ?? 'Leaderboard'}</div>
        {workout?.raw_text && (
          <pre style={{ whiteSpace: 'pre-wrap', font: '700 11px/1.6 "Space Mono", monospace', marginTop: 8 }}>
            {workout.raw_text}
          </pre>
        )}

        {entries.length === 0 && (
          <div className="hw-card" style={{ marginTop: 16 }}>
            <p style={{ margin: 0 }}>No scores logged yet.</p>
          </div>
        )}

        {timeEntries.length > 0 && (
          <div className="hw-card" style={{ marginTop: 16 }}>
            <span className="hw-h3">For Time</span>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {timeEntries.map((e, i) => (
                <div key={e.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span><strong>#{i + 1}</strong> <Avatar name={e.profiles?.display_name ?? 'Athlete'} url={e.profiles?.avatar_url ?? null} />{e.profiles?.display_name ?? 'Athlete'}</span>
                    <span style={{ fontWeight: 700 }}>{formatTime(e.result_value.seconds)}{e.rpe ? ` · RPE ${e.rpe}` : ''}</span>
                  </div>
                  {renderMeta(e.id)}
                </div>
              ))}
            </div>
          </div>
        )}

        {roundsRepsEntries.length > 0 && (
          <div className="hw-card" style={{ marginTop: 12 }}>
            <span className="hw-h3">Rounds + Reps</span>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {roundsRepsEntries.map((e, i) => (
                <div key={e.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span><strong>#{i + 1}</strong> <Avatar name={e.profiles?.display_name ?? 'Athlete'} url={e.profiles?.avatar_url ?? null} />{e.profiles?.display_name ?? 'Athlete'}</span>
                    <span style={{ fontWeight: 700 }}>
                      {e.result_value.rounds} rounds + {e.result_value.reps}{e.rpe ? ` · RPE ${e.rpe}` : ''}
                    </span>
                  </div>
                  {renderMeta(e.id)}
                </div>
              ))}
            </div>
          </div>
        )}

        {[...loadEntriesByMovement.entries()].map(([movementName, list]) => (
          <div key={movementName} className="hw-card" style={{ marginTop: 12 }}>
            <span className="hw-h3">{movementName}</span>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {list.map((e, i) => (
                <div key={e.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
                    <span><strong>#{i + 1}</strong> <Avatar name={e.profiles?.display_name ?? 'Athlete'} url={e.profiles?.avatar_url ?? null} />{e.profiles?.display_name ?? 'Athlete'}</span>
                    <span style={{ fontWeight: 700 }}>
                      {e.result_value.weight} × {e.result_value.reps} × {e.result_value.sets} sets
                      {e.rpe ? ` · RPE ${e.rpe}` : ''}
                    </span>
                  </div>
                  {renderMeta(e.id)}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
