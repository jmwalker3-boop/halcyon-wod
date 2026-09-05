import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Black Box Method',
  description: 'Doctrine-driven GPP programming.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Bungee (display), Space Grotesk (body), Space Mono (labels/numbers) --
            the HalcyonWod product UI (app/globals.css, "hw-" classes), used by
            /dashboard and /settings. Loaded globally so a page can opt in to
            the "hw-shell" look without a per-page font dance. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bungee&family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
