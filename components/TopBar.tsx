'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LogoutButton from '@/components/LogoutButton';
import { createClient } from '@/lib/supabase/client';

// Locked top banner (John's correction, 2026-09-13: NOT a mirror of the
// bottom TabBar -- the bottom bar already covers Board/Chat/Wod/PRs/Account
// navigation, so this one instead carries the admin-only Admin link and a
// way to log out, both of which used to live only on /dashboard). Fetches
// its own admin status client-side (same profiles.role check /dashboard
// does server-side) so every page that mounts this gets the Admin link
// without each page having to fetch and pass down isAdmin itself.
export default function TopBar() {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      setIsAdmin(profile?.role === 'admin');
    })();
  }, []);

  return (
    <nav
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 16px',
        background: 'var(--hw-paper)',
        borderBottom: '4px solid var(--hw-ink)',
      }}
    >
      <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', lineHeight: 0 }}>
        <img src="/logo-dot.png" alt="HalcyonWod" style={{ width: 36, height: 36, objectFit: 'contain' }} />
      </Link>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {isAdmin && (
          <Link href="/admin" className="hw-link-back">
            Admin
          </Link>
        )}
        <LogoutButton />
      </div>
    </nav>
  );
}
