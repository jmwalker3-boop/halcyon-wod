'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Small shared client component so /dashboard (a server component) can
// still offer a logout affordance -- John's request (2026-09-07): with two
// separate accounts (admin + athlete) in active use for testing, there was
// no way to sign out of one to sign into the other without clearing
// cookies or using a private window, which is exactly the kind of friction
// that pushed him toward wanting password sign-in too (see /login).
export default function LogoutButton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className={className ?? 'hw-link-back'}
      // Deliberately just `border: none, cursor: pointer` -- a <button> has none
      // of an <a>'s default styling to strip, but overriding background/padding/font
      // here (an earlier version did) fights the className, since inline styles
      // always win over a CSS class. That silently broke the pill look every other
      // header link uses (John's report, 2026-09-07: "Log out" rendered as bare
      // text instead of matching Coach Deck/Admin/Setup).
      style={{ border: 'none', cursor: 'pointer', ...style }}
    >
      {loading ? 'Signing out…' : 'Log out'}
    </button>
  );
}
