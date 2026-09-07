import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

// Stable target for the bottom nav's "Board" tab (see components/TabBar.tsx) --
// /leaderboard/[workoutId] always needs a workoutId, so this resolves
// "today's workout, for me" server-side and redirects there. Falls back
// to /dashboard when there's no workout today (not enrolled, rest day,
// or not generated yet) rather than a dead page.
export default async function BoardRedirectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const today = new Date().toISOString().slice(0, 10);

  const { data: enrollments } = await supabase
    .from('program_enrollments')
    .select('programs ( program_cycles ( calendar_slots ( date, workouts ( id ) ) ) )')
    .eq('profile_id', user.id)
    .eq('active', true);

  for (const enrollment of (enrollments ?? []) as any[]) {
    for (const cycle of enrollment.programs?.program_cycles ?? []) {
      const slot = (cycle.calendar_slots ?? []).find((s: any) => s.date === today && s.workouts);
      if (slot) redirect(`/leaderboard/${slot.workouts.id}`);
    }
  }

  redirect('/dashboard');
}

