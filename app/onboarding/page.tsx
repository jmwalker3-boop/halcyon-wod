import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import OnboardingWizard, { type Track } from './OnboardingWizard';

// Server wrapper for mockup screens 3a-3c ("the screens that make every
// 'your Rx' state work"). Nothing here was reachable before this file
// existed -- a new athlete had no route to pick a program, record gear, or
// set a skill level, so /dashboard's "not enrolled" card just dead-ended.
//
// Redirects straight to /dashboard if the athlete already has an active
// enrollment -- this is a first-run flow, not a settings page (that's
// /account, which reuses the same gear/skill fields for later edits).
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ switch?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // /account's "switch / add a track" link reopens this same picker for an
  // already-enrolled athlete -- everything below this still works exactly
  // as it does for a first-run athlete (upsert, not insert-only), so a
  // returning visit through here is just as safe as a first one.
  const { switch: switchParam } = await searchParams;
  if (!switchParam) {
    const { data: enrollments } = await supabase
      .from('program_enrollments')
      .select('program_id')
      .eq('profile_id', user.id)
      .eq('active', true);
    if (enrollments && enrollments.length > 0) redirect('/dashboard');
  }

  // program_cycles carries the two facts the mockup shows as badges on each
  // track card (length_days -> "42-DAY CYCLE", format_pattern -> "3 ON · 1
  // OFF") -- pulled from the real cycle rather than hand-copied, so a track
  // card never claims a cadence the schedule doesn't back up. A program can
  // accumulate multiple cycles over time; the most recently started one is
  // what's currently true of it.
  const { data: programs } = await supabase
    .from('programs')
    .select('id, name, program_cycles ( start_date, length_days, format_pattern )')
    .order('name');

  const tracks: Track[] = (programs ?? []).map((p: any) => {
    const cycles = [...(p.program_cycles ?? [])].sort((a: any, b: any) => (a.start_date < b.start_date ? 1 : -1));
    const latest = cycles[0] ?? null;
    return {
      id: p.id,
      name: p.name,
      lengthDays: latest?.length_days ?? null,
      formatPattern: latest?.format_pattern ?? null,
    };
  });

  return <OnboardingWizard tracks={tracks} />;
}
