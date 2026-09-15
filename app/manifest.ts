import type { MetadataRoute } from 'next';

// PWA home-screen icon (John's request, 2026-09-15): uses the HalcyonWod
// "dot" sticker badge (public/logo-dot.png -- sun/palm/wave die-cut mark)
// composited onto the hw-paper cream background rather than shipped raw
// with transparency, since most launchers render a transparent PNG on an
// ugly white or black square. Icon files generated from that source at
// public/icon-*.png; the maskable variant carries extra safe-zone padding
// per the Android adaptive-icon spec.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HalcyonWod',
    short_name: 'HalcyonWod',
    description: 'Real programming, scaled to your equipment and your numbers.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFF8EC',
    theme_color: '#22E0D6',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

