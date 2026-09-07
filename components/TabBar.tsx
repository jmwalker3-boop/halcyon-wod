import Link from 'next/link';

// Bottom nav shell from the "HalcyonWod Mockups" design (screen 2a/1b,
// 2026-09-07): Home/Board/WOD/Stats/Me, WOD raised as the center icon
// since /dashboard IS the WOD-of-the-day view -- there's no separate
// "home feed" in this app, so Home and WOD both point here for now.
// Board -> today's leaderboard (falls back to /dashboard if there's no
// workout to show scores for yet); Stats -> /prs (John's call,
// 2026-09-07: no separate charts/streak-history screen yet, just point
// it at the PR log that already exists); Me -> /account.
export default function TabBar({
  active,
  boardHref,
}: {
  active: 'home' | 'board' | 'wod' | 'stats' | 'me';
  boardHref?: string;
}) {
  const items: { key: typeof active; label: string; href: string; icon: string }[] = [
    { key: 'home', label: 'Home', href: '/dashboard', icon: '●' },
    { key: 'board', label: 'Board', href: boardHref ?? '/dashboard', icon: '◆' },
    { key: 'wod', label: 'Wod', href: '/dashboard', icon: '💀' },
    { key: 'stats', label: 'Stats', href: '/prs', icon: '▲' },
    { key: 'me', label: 'Me', href: '/account', icon: '☺' },
  ];

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
        const isActive = item.key === active;
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
                width: isActive ? 44 : 32,
                height: isActive ? 44 : 32,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: isActive ? 20 : 14,
                background: isActive ? 'var(--hw-mustard)' : 'transparent',
                border: isActive ? '3px solid var(--hw-ink)' : '2px solid var(--hw-ink)',
                boxShadow: isActive ? '3px 3px 0 var(--hw-ink)' : 'none',
                marginTop: isActive ? -14 : 0,
              }}
            >
              {item.icon}
            </span>
            <span className="hw-label" style={{ fontSize: 8, opacity: isActive ? 1 : 0.6 }}>
              {item.label.toUpperCase()}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

