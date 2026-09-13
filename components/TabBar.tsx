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
//
// Icons are inline SVGs (John's request, 2026-09-07: real glyphs, not
// emoji/text placeholders) -- all use currentColor so they inherit the
// same active/inactive coloring the surrounding span already computes.

function BoardIcon({ size }: { size: number }) {
  // Three podium bars (1st tallest in the middle, 2nd/3rd shorter either
  // side) -- "replicating the 1st, 2nd, 3rd spots."
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="3" y="9" width="5" height="12" rx="1" />
      <rect x="9.5" y="3" width="5" height="18" rx="1" />
      <rect x="16" y="13" width="5" height="8" rx="1" />
    </svg>
  );
}

function ChatIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="2" y="4" width="20" height="13" rx="3" />
      <polygon points="6,17 6,22 11,17" />
    </svg>
  );
}

function SkullIcon({ size }: { size: number }) {
  // Solid fill (John's request, 2026-09-07: "check earlier drafts for the
  // WOD skull, it was filled in black and larger") -- eyes/nose are holes
  // punched out of the same currentColor path via fill-rule evenodd, so
  // they show through as the badge's own background color instead of
  // needing a second hardcoded color.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" clipRule="evenodd">
      <path d="M12 2.5c-4.4 0-7.5 3.2-7.5 7.3 0 2.4 1 4 2.1 5.1.3.3.4.7.4 1.1v1.3c0 .6.5 1.1 1.1 1.1h1v1.5c0 .6.5 1.1 1.1 1.1h1.6v-2.2h2.4v2.2h1.6c.6 0 1.1-.5 1.1-1.1v-1.5h1c.6 0 1.1-.5 1.1-1.1v-1.3c0-.4.1-.8.4-1.1 1.1-1.1 2.1-2.7 2.1-5.1 0-4.1-3.1-7.3-7.5-7.3zM9.3 9.1a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zm5.4 0a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM11.3 13.2h1.4l-.7 1.6z" />
    </svg>
  );
}

function BarbellIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="0.5" y="9" width="3" height="6" rx="0.5" />
      <rect x="3.8" y="7" width="2" height="10" rx="0.5" />
      <rect x="6" y="11" width="12" height="2" />
      <rect x="18.2" y="7" width="2" height="10" rx="0.5" />
      <rect x="20.5" y="9" width="3" height="6" rx="0.5" />
    </svg>
  );
}

function AccountIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

export default function TabBar({ boardHref }: { boardHref?: string }) {
  const pathname = usePathname();

  const items: { key: string; label: string; href: string; Icon: (props: { size: number }) => React.JSX.Element }[] = [
    { key: 'board', label: 'Board', href: boardHref ?? '/board', Icon: BoardIcon },
    { key: 'chat', label: 'Chat', href: '/chat', Icon: ChatIcon },
    { key: 'wod', label: 'Wod', href: '/wod', Icon: SkullIcon },
    { key: 'prs', label: 'PRs', href: '/prs', Icon: BarbellIcon },
    { key: 'account', label: 'Account', href: '/account', Icon: AccountIcon },
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
        const Icon = item.Icon;
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
                background: isWod ? 'var(--hw-mustard)' : active ? 'var(--hw-ink)' : 'transparent',
                color: isWod ? 'var(--hw-ink)' : active ? 'var(--hw-mustard)' : 'var(--hw-ink)',
                border: '3px solid var(--hw-ink)',
                boxShadow: isWod ? '3px 3px 0 var(--hw-ink)' : 'none',
                ...(isWod ? { marginTop: -16 } : {}),
              }}
            >
              <Icon size={isWod ? 30 : 16} />
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
