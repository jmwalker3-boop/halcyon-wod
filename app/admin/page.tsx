'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LogoutButton from '@/components/LogoutButton';
import { createClient } from '@/lib/supabase/client';

// Minimal admin tool (John's own scoping, 2026-09-06): "let's build that
// [enrollment tool]... so we don't have to bake a lot in later." Exists to
// unblock beta testing -- a friend signs in via magic link (which
// auto-creates their profiles row via handle_new_user, role='athlete'), but
// nothing puts them on a program: /dashboard reads program_enrollments
// directly and there was no write path to it at all (not even for admin)
// before this, and no client-side way to resolve an email to a profile id
// regardless (auth.users isn't exposed to the anon-key client). Both gaps
// are closed by one thing: the admin_enroll_by_email() Postgres function
// (SECURITY DEFINER, admin-gated internally via is_admin()) -- it does the
// auth.users lookup and the program_enrollments upsert atomically, so this
// page is just a thin form over one RPC call.
//
// "Everyone will be on the program initially" (John, 2026-09-06 -- no
// separate tracks/decks for now) is exactly why this doesn't take a program
// picker: admin_enroll_by_email() always enrolls into the one program that
// exists. If a second program ever gets created, this page (and that
// function) need a real picker -- deliberately not built ahead of that
// need.
type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

type Enrollment = {
  profile_id: string;
  active: boolean;
  joined_at: string;
  profiles: { display_name: string | null; role: string } | null;
};

export default function AdminPage() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [email, setEmail] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [enrollMessage, setEnrollMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [pwEmail, setPwEmail] = useState('');
  const [pwPassword, setPwPassword] = useState('');
  const [settingPassword, setSettingPassword] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  async function loadEnrollments() {
    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from('program_enrollments')
      .select('profile_id, active, joined_at, profiles ( display_name, role )')
      .order('joined_at', { ascending: false });
    if (fetchError) {
      setError(fetchError.message);
      setLoadState('error');
      return;
    }
    setEnrollments((data ?? []) as unknown as Enrollment[]);
    setLoadState('ready');
  }

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('Not signed in.');
        setLoadState('error');
        return;
      }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      if (profile?.role !== 'admin') {
        setLoadState('forbidden');
        return;
      }
      await loadEnrollments();
    })();
  }, []);

  async function handleEnroll(e: React.FormEvent) {
    e.preventDefault();
    setEnrolling(true);
    setEnrollMessage(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc('admin_enroll_by_email', { target_email: email.trim() });
    if (rpcError) {
      setEnrollMessage({ kind: 'error', text: rpcError.message });
      setEnrolling(false);
      return;
    }
    setEnrollMessage({ kind: 'ok', text: `Enrolled ${email.trim()}.` });
    setEmail('');
    setEnrolling(false);
    await loadEnrollments();
  }

  // Server-side, not the RPC pattern the enroll form uses above -- setting
  // ANOTHER account's password isn't something supabase.auth.updateUser()
  // can do (that only ever touches the caller's own session), so this hits
  // a route handler that does the write via a direct, RLS-bypassing
  // Postgres connection instead (see app/api/admin/set-password/route.ts).
  // John's request, 2026-09-07: no SMTP yet, so an enrolled account that
  // never set its own password (Settings requires being logged in AS it
  // first) was otherwise a dead end for admin to get into.
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setSettingPassword(true);
    setPwMessage(null);
    // Wrapped in try/catch/finally deliberately -- an earlier version read
    // res.json() unconditionally, which throws if the server ever returns
    // something that isn't valid JSON (a 500 from an unhandled exception in
    // the route renders as an HTML error page, not JSON). That left the
    // button stuck on "Setting..." forever with no visible error (John's
    // report, 2026-09-07) instead of surfacing whatever actually broke.
    try {
      const res = await fetch('/api/admin/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pwEmail.trim(), password: pwPassword }),
      });
      let body: { error?: string } = {};
      try {
        body = await res.json();
      } catch {
        // Response wasn't JSON at all (e.g. a raw 500 HTML page) -- fall
        // through to the generic error below rather than throwing here.
      }
      if (!res.ok) {
        setPwMessage({ kind: 'error', text: body.error ?? `Request failed (${res.status}).` });
        return;
      }
      setPwMessage({ kind: 'ok', text: `Password set for ${pwEmail.trim()}.` });
      setPwEmail('');
      setPwPassword('');
    } catch (err) {
      setPwMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Network error.' });
    } finally {
      setSettingPassword(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <main className="hw-shell">
        <div className="hw-wrap">
          <p className="hw-muted">Loading…</p>
        </div>
      </main>
    );
  }

  if (loadState === 'forbidden') {
    return (
      <main className="hw-shell">
        <div className="hw-wrap">
          <Link href="/dashboard" className="hw-link-back">← Back</Link>
          <p style={{ marginTop: 16 }}>Admin only.</p>
        </div>
      </main>
    );
  }

  if (loadState === 'error') {
    return (
      <main className="hw-shell">
        <div className="hw-wrap">
          <p className="hw-error">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/dashboard" style={{ flex: 'none', lineHeight: 0 }}>
            <img src="/logo-dot.png" alt="HalcyonWod" style={{ width: 44, height: 44, objectFit: 'contain' }} />
          </Link>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="hw-eyebrow">Admin</span>
          </div>
          <Link href="/dashboard" className="hw-link-back">Today&apos;s WOD</Link>
          <LogoutButton />
        </div>
        <div className="hw-h1" style={{ fontSize: 26, color: 'var(--hw-ink)', textShadow: 'none', marginTop: 12 }}>
          Enroll an Athlete
        </div>
        <p className="hw-lede">
          They need to have signed in at least once (via the magic-link login) before this works --
          it looks up their account by email, it can&apos;t create one.
        </p>

        <form onSubmit={handleEnroll} className="hw-card" style={{ marginTop: 16 }}>
          <span className="hw-label">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="friend@example.com"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 8,
              font: '700 14px/1 "Space Grotesk", sans-serif',
              padding: '12px 14px',
              border: '2px solid var(--hw-ink)',
              borderRadius: 8,
              background: 'var(--hw-paper)',
              color: 'var(--hw-ink)',
            }}
          />
          <button
            type="submit"
            disabled={enrolling}
            className="hw-btn hw-btn-mustard"
            style={{ marginTop: 12, fontSize: 15, padding: 12 }}
          >
            {enrolling ? 'Enrolling…' : 'Enroll'}
          </button>
          {enrollMessage && (
            <p
              className={enrollMessage.kind === 'error' ? 'hw-error' : undefined}
              style={{ marginTop: 10, marginBottom: 0, fontSize: 13, color: enrollMessage.kind === 'ok' ? 'var(--hw-violet)' : undefined }}
            >
              {enrollMessage.text}
            </p>
          )}
        </form>

        <form onSubmit={handleSetPassword} className="hw-card" style={{ marginTop: 12 }}>
          <span className="hw-label" style={{ color: 'var(--hw-violet)' }}>Set a Password for Any Account</span>
          <p className="hw-muted" style={{ fontSize: 12, marginTop: 8 }}>
            For getting into an enrolled account that never set its own password (no email needed).
          </p>
          <input
            type="email"
            required
            value={pwEmail}
            onChange={(e) => setPwEmail(e.target.value)}
            placeholder="athlete@example.com"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 10,
              font: '700 14px/1 "Space Grotesk", sans-serif',
              padding: '12px 14px',
              border: '2px solid var(--hw-ink)',
              borderRadius: 8,
              background: 'var(--hw-paper)',
              color: 'var(--hw-ink)',
            }}
          />
          <input
            type="password"
            required
            minLength={6}
            value={pwPassword}
            onChange={(e) => setPwPassword(e.target.value)}
            placeholder="New password"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 8,
              font: '700 14px/1 "Space Grotesk", sans-serif',
              padding: '12px 14px',
              border: '2px solid var(--hw-ink)',
              borderRadius: 8,
              background: 'var(--hw-paper)',
              color: 'var(--hw-ink)',
            }}
          />
          <button
            type="submit"
            disabled={settingPassword}
            className="hw-btn hw-btn-dark"
            style={{ marginTop: 12, fontSize: 15, padding: 12 }}
          >
            {settingPassword ? 'Setting…' : 'Set password'}
          </button>
          {pwMessage && (
            <p
              className={pwMessage.kind === 'error' ? 'hw-error' : undefined}
              style={{ marginTop: 10, marginBottom: 0, fontSize: 13, color: pwMessage.kind === 'ok' ? 'var(--hw-violet)' : undefined }}
            >
              {pwMessage.text}
            </p>
          )}
        </form>

        <div className="hw-eyebrow-row" style={{ marginTop: 20 }}>
          <span className="hw-h3">Currently Enrolled</span>
          <span className="hw-pill hw-pill-outline">{enrollments.filter((e) => e.active).length}</span>
        </div>

        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {enrollments.length === 0 && (
            <div className="hw-card">
              <p className="hw-muted" style={{ margin: 0 }}>No one enrolled yet.</p>
            </div>
          )}
          {enrollments.map((e) => (
            <div
              key={e.profile_id}
              className="hw-card"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12 }}
            >
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                {e.profiles?.display_name || '(no name set)'}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className="hw-pill hw-pill-outline">{e.profiles?.role}</span>
                {!e.active && <span className="hw-pill hw-pill-outline">inactive</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
