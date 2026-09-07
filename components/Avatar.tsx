export default function Avatar({ name, url, size = 22 }: { name: string; url: string | null; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '1.5px solid var(--hw-ink)',
        background: url ? `center/cover no-repeat url(${url})` : 'var(--hw-violet)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        font: '700 10px/1 "Space Grotesk", sans-serif',
        marginRight: 6,
        verticalAlign: 'middle',
      }}
    >
      {!url && (name.trim().charAt(0).toUpperCase() || '?')}
    </span>
  );
}

