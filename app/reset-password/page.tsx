'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

// Redeems the token from the emailed link against
// app/api/auth/reset-password/route.ts -- not a Supabase session (the
// request route never created one), so this can't use
// supabase.auth.updateUser() the way /account's "set password" card does.
//
// Reads the token via window.location rather than useSearchParams() --
// that hook needs a Suspense boundary to prerender at build time (Next.js
// build fails otherwise), and this page has no other reason to reach for
// it.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStatus('error');
        setError(body.error ?? 'Something went wrong. Try again.');
        return;
      }
      setStatus('saved');
      setTimeout(() => router.push('/login'), 2000);
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
        <div className="hw-h1" style={{ textAlign: 'center', fontSize: 28 }}>Set a new password</div>

        <div className="hw-card" style={{ marginTop: 24 }}>
          {token === null ? null : !token ? (
            <>
              <span className="hw-eyebrow">Missing link</span>
              <p style={{ marginTop: 12, marginBottom: 0 }}>
                This page needs a reset link. <Link href="/forgot-password" className="hw-link-back">Request one here</Link>.
              </p>
            </>
          ) : status === 'saved' ? (
            <>
              <span className="hw-eyebrow">Password set</span>
              <p style={{ marginTop: 12, marginBottom: 0 }}>Redirecting you to sign in…</p>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <span className="hw-eyebrow">New password</span>
              <input
                type="password"
                required
                minLength={6}
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
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
                disabled={status === 'saving'}
                className="hw-btn hw-btn-mustard"
                style={{ marginTop: 14, fontSize: 15, padding: 14 }}
              >
                {status === 'saving' ? 'Saving…' : 'Set password'}
              </button>
              {error && <p className="hw-error" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>{error}</p>}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
