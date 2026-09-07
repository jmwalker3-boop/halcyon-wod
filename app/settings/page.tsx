import { redirect } from 'next/navigation';

// /settings was replaced by /account (John's request, 2026-09-07: a single
// consolidated account hub instead of gear/skill/password living apart from
// profile+billing). Kept as a redirect rather than deleted so any existing
// bookmark or stray link still lands somewhere real.
export default function SettingsRedirect() {
  redirect('/account');
}
