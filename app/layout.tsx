import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Black Box Method',
  description: 'Doctrine-driven CrossFit programming.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
