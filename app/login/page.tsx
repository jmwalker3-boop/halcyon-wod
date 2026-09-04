'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

// Magic-link only, deliberately -- no password field, so there's no
// password-reset flow to build for a v0 skeleton. Trades a slightly slower
// sign-in (check your email) for skipping an entire auth surface.
export default function LoginPage() {
  const [email, setEmail] = useState('');
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

  async function handleSubmit(e: React.FormEvent) {
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

  return (
    <main className="container">
      <h1>Black Box Method</h1>
      {status === 'sent' ? (
        <p>Check {email} for a sign-in link.</p>
      ) : (
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button type="submit" disabled={status === 'sending'}>
            {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
          </button>
          {error && <p style={{ color: '#e07a7a' }}>{error}</p>}
        </form>
      )}
    </main>
  );
}
