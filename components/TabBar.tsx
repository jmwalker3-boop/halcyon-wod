'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Locked bottom nav (John's request, 2026-09-07): Board / Chat / WOD
// (skull, raised center) / PRs / Account. WOD -> /wod, the dedicated
// today's-workout detail page (see app/wod/page.tsx -- split out of
// /dashboard the same day, "the wod and 'as written' and 'my rx' stuff
// should all be under the 'wod (skull)' page"). Board has no fixed
// destination of its own (a leaderboard route always needs a workoutId),
// so it goes through /board, which resolves today's workout server-side
// and redirects -- every page gets a working Board tab without having to
// know today's workoutId itself. `boardHref` lets a page that already
// knows the exact workout (like /wod itself) skip that extra redirect.
export default function TabBar({ boardHref }: { boardHref?: string }) {
  const pathname = usePathname();

  const items: { key: string; label: string; href: string; icon: string }[] = [
    { key: 'board', label: 'Board', href: boardHref ?? '/board', icon: '◆' },
    { key: 'chat', label: 'Chat', href: '/chat', icon: '●' },
    { key: 'wod', label: 'Wod', href: '/wod', icon: '💀' },
    { key: 'prs', label: 'PRs', href: '/prs', icon: '▲' },
    { key: 'account', label: 'Account', href: '/account', icon: '☺' },
  ];

  function isActive(item: (typeof items)[number]) {
    if (item.key === 'board') return pathname.startsWith('/leaderboard');
    if (item.key === 'account') return pathname.startsWith('/account') || pathname.startsWith('/billing');
    return pathname.startsWith(`/${item.key}`);
  }

  return (
    <nav
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 30,
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'flex-end',
        padding: '10px 8px 20px',
        background: 'var(--hw-paper)',
        borderTop: '4px solid var(--hw-ink)',
      }}
    >
      {items.map((item) => {
        const active = isActive(item);
        const isWod = item.key === 'wod';
        return (
          <Link
            key={item.key}
            href={item.href}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              textDecoration: 'none',
              color: 'var(--hw-ink)',
              flex: 1,
            }}
          >
            <span
              style={{
                width: isWod ? 48 : 32,
                height: isWod ? 48 : 32,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isWod ? 22 : 14,
                background: isWod ? 'var(--hw-mustard)' : active ? 'var(--hw-ink)' : 'transparent',
                color: isWod ? 'var(--hw-ink)' : active ? 'var(--hw-mustard)' : 'var(--hw-ink)',
                border: '3px solid var(--hw-ink)',
                boxShadow: isWod ? '3px 3px 0 var(--hw-ink)' : 'none',
                marginTop: isWod ? -16 : 0,
              }}
            >
              {item.icon}
            </span>
            <span className="hw-label" style={{ fontSize: 8, opacity: active || isWod ? 1 : 0.6 }}>
              {item.label.toUpperCase()}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

