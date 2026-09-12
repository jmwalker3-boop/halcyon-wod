'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// Magic-link-only originally, deliberately -- no password field, so there
// was no password-reset flow to build for a v0 skeleton. Extended
// 2026-09-07 to add password sign-in ALONGSIDE the magic link (not instead
// of it) -- John's request, running two accounts (admin + athlete) for
// testing and wanting to switch between them without waiting on email each
// time. A password is optional per-account: set one from /settings once
// signed in, and the password field below works from then on; the magic
// link still works regardless, since that's still how a brand-new athlete
// gets in the door the first time.
//
// Restyled 2026-09-05 to the hw- design system (same one as /dashboard and
// /settings) so this is the first thing an athlete sees on-brand rather
// than the plain base-token page it used to be.
export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'password' | 'magic-link'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // Two distinct failure paths land back on this page and both need
  // surfacing, or a broken sign-in just silently dumps someone back at a
  // blank email box with no explanation (exactly what happened before this
  // was added -- Supabase was reporting the real reason the whole time,
  // this page just wasn't reading it):
  //  1. Supabase's own /auth/v1/verify rejects the emailed token (expired,
  //     already used, tampered) *before* ever reaching our /auth/callback
  //     route -- it reports that as a hash fragment (#error=...), which
  //     only exists client-side and never shows up in server logs.
  //  2. Our /auth/callback route received a code but
  //     exchangeCodeForSession() failed anyway (e.g. a PKCE code-verifier
  //     mismatch from opening the link in a different browser/device than
  //     the one that requested it) -- that one redirects back here with a
  //     plain ?error=auth_callback_failed query param instead.
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const hashDescription = hashParams.get('error_description');
    if (hashDescription) {
      setStatus('error');
      setError(decodeURIComponent(hashDescription.replace(/\+/g, ' ')));
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    const queryParams = new URLSearchParams(window.location.search);
    if (queryParams.get('error') === 'auth_callback_failed') {
      setStatus('error');
      setError(
        "That sign-in link didn't work -- often this means it was opened in a different browser or device than the one you requested it from. Try requesting a new link and opening it in this same browser.",
      );
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });

    if (error) {
      setStatus('error');
      setError(error.message);
      return;
    }
    setStatus('sent');
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setStatus('sending');
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus('error');
      setError(error.message);
      return;
    }
    router.push('/dashboard');
    router.refresh();
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
        <div className="hw-h1" style={{ textAlign: 'center', fontSize: 28 }}>HalcyonWod</div>
        <p className="hw-lede" style={{ textAlign: 'center' }}>GPP workouts written by a CFL3 coach, scaled to you.</p>

        <div className="hw-card" style={{ marginTop: 24 }}>
          {status === 'sent' ? (
            <>
              <span className="hw-eyebrow">Check your inbox</span>
              <p style={{ marginTop: 12, marginBottom: 0 }}>
                Sent a sign-in link to <strong>{email}</strong>. Open it in this same browser.
              </p>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button
                  type="button"
                  onClick={() => {
                    setMode('password');
                    setStatus('idle');
                    setError(null);
                  }}
                  className={mode === 'password' ? 'hw-pill hw-pill-mustard' : 'hw-pill hw-pill-outline'}
                  style={{ border: 'none', cursor: 'pointer' }}
                >
                  Password
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('magic-link');
                    setStatus('idle');
                    setError(null);
                  }}
                  className={mode === 'magic-link' ? 'hw-pill hw-pill-mustard' : 'hw-pill hw-pill-outline'}
                  style={{ border: 'none', cursor: 'pointer' }}
                >
                  Email link
                </button>
              </div>

              {mode === 'password' ? (
                <form onSubmit={handlePasswordSignIn}>
                  <span className="hw-eyebrow">Sign in</span>
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
                  <input
                    type="password"
                    required
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={{
                      display: 'block',
                      width: '100%',
                      marginTop: 10,
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
                    {status === 'sending' ? 'Signing inâ¦' : 'Sign in'}
                  </button>
                  <p className="hw-muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
                    No password set yet? Use the email link tab once, then set one from Setup.
                  </p>
                  {error && <p className="hw-error" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>{error}</p>}
                </form>
              ) : (
                <form onSubmit={handleMagicLink}>
                  <span className="hw-eyebrow">Sign in</span>
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
                    {status === 'sending' ? 'Sendingâ¦' : 'Send sign-in link'}
                  </button>
                  {error && <p className="hw-error" style={{ fontSize: 13, marginTop: 12, marginBottom: 0 }}>{error}</p>}
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
