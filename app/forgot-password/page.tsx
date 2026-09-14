'use client';

import { useState } from 'react';
import Link from 'next/link';

// Mirrors /login's magic-link "sent" pattern: always shows the same
// confirmation regardless of whether the email exists (the API route
// enforces that -- see app/api/auth/request-password-reset/route.ts) so
// this page can't be used to check which emails have accounts.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      const res = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus('error');
        setError(body.error ?? 'Something went wrong. Try again.');
        return;
      }
      setStatus('sent');
    } catch {
      setStatus('error');
      setError('Network error. Try again.');
    }
  }

  return (
    <main className="hw-shell" style={{ display: 'flex', alignItems: 'center' }}>
      <div className="hw-wrap" style={{ width: '100%' }}>
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <img
            src="/logo-dot.png"
            alt="HalcyonWod"
            style={{ width: 84, height: 84, objectFit: 'contain', margin: '0 auto' }}
          />
        </div>
        <div className="hw-h1" style={{ textAlign: 'center', fontSize: 28 }}>Reset password</div>

        <div className="hw-card" style={{ marginTop: 24 }}>
          {status === 'sent' ? (
            <>
              <span className="hw-eyebrow">Check your inbox</span>
              <p style={{ marginTop: 12, marginBottom: 0 }}>
                If an account exists for <strong>{email}</strong>, a reset link is on its way.
              </p>
              <Link href="/login" className="hw-link-back" style={{ display: 'inline-block', marginTop: 16 }}>
                ← Back to sign in
              </Link>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <span className="hw-eyebrow">Forgot password</span>
              <p className="hw-lede" style={{ marginTop: 10 }}>
                Enter your email and we&apos;ll send a link to set a new password.
              </p>
              <input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 14,
                  font: '700 14px/1 "Space Grotesk", sans-serif',
                  padding: '14px 16px',
                  border: '3px solid var(--hw-ink)',
                  borderRadius: 999,
                  background: 'var(--hw-paper)',
                  color: 'var(--hw-ink)',
                }}
              />
              <button
                type="submit"
                disabled={status === 'sending'}
                className="hw-btn hw-btn-mustard"
                style={{ marginTop: 14, fontSize: 15, padding: 14 }}
              >
                {status === 'sending' ? 'Sending…' : 'Send reset link'}
              </button>
              {error && <p className="hw-error" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>{error}</p>}
              <Link href="/login" className="hw-link-back" style={{ display: 'inline-block', marginTop: 16 }}>
                ← Back to sign in
              </Link>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
