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
      style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', padding: 0, ...style }}
    >
      {loading ? 'Signing out…' : 'Log out'}
    </button>
  );
}

