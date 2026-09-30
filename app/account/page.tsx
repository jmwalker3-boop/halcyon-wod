'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LogoutButton from '@/components/LogoutButton';
import { createClient } from '@/lib/supabase/client';
import TabBar from '@/components/TabBar';
import TopBar from '@/components/TopBar';

// Consolidated account hub (John's request, 2026-09-07: "we should have an
// 'account' page, too, for athletes" -- and when asked how far to take it,
// "consolidate everything"). Replaces /settings as the main athlete-facing
// settings surface, plus two things that had no UI anywhere before now --
// profile basics (profiles.display_name/timezone, columns that existed
// since the very first migration but were never editable) and a compact
// billing summary linking out to /billing rather than duplicating that
// page's checkout logic here. /settings itself now just redirects here
// (see app/settings/page.tsx) so no existing link/bookmark breaks.
//
// Gear/skill-level personalization removed (John's call, 2026-09-29): Rx /
// Scaled / Minimal on /wod replaces per-athlete equipment/skill resolution
// with fixed, pre-authored workout variants, so there's nothing here left
// to resolve against. "Your track" is what's left worth an explicit save --
// switching used to bounce out to the full onboarding wizard just to change
// one selection; it's inline here now, with its own Save changes button.

type LoadState = 'loading' | 'ready' | 'error';
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type BillingSummary = { status: string; planName: string } | null;

export default function AccountPage() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [profileState, setProfileState] = useState<SaveState>('idle');
  const [profileError, setProfileError] = useState<string | null>(null);

  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [tracks, setTracks] = useState<{ id: string; name: string }[]>([]);
  const [activeProgramIds, setActiveProgramIds] = useState<string[]>([]);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [trackSaveState, setTrackSaveState] = useState<SaveState>('idle');
  const [trackError, setTrackError] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [passwordState, setPasswordState] = useState<SaveState>('idle');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [billing, setBilling] = useState<BillingSummary>(null);
  const [cancelState, setCancelState] = useState<'idle' | 'canceling' | 'error'>('idle');
  const [cancelError, setCancelError] = useState<string | null>(null);

  const [deleteAccountConfirmText, setDeleteAccountConfirmText] = useState('');
  const [deleteAccountState, setDeleteAccountState] = useState<'idle' | 'deleting' | 'error'>('idle');
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

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

      const [
        { data: profileRow, error: profileFetchError },
        { data: subscriptionRow },
        { data: programRows },
        { data: enrollmentRows },
      ] = await Promise.all([
        supabase.from('profiles').select('display_name, avatar_url, timezone').eq('id', user.id).single(),
        supabase
          .from('subscriptions')
          .select('status, plans ( name )')
          .eq('profile_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        // "YOUR TRACK" card -- every track a coach has set up, for the picker.
        supabase.from('programs').select('id, name').order('name'),
        // Every program this athlete is currently active in. Multiple is a
        // supported state (an athlete can be enrolled in more than one
        // program), so this tracks all of them, not just one.
        supabase.from('program_enrollments').select('program_id').eq('profile_id', user.id).eq('active', true),
      ]);

      if (profileFetchError) {
        setError(profileFetchError.message);
        setLoadState('error');
        return;
      }

      setDisplayName(profileRow?.display_name ?? '');
      setAvatarUrl(profileRow?.avatar_url ?? null);
      setTimezone(profileRow?.timezone ?? 'UTC');
      setTracks((programRows ?? []).map((p: any) => ({ id: p.id, name: p.name })));
      const activeIds = (enrollmentRows ?? []).map((r: any) => r.program_id as string);
      setActiveProgramIds(activeIds);
      setSelectedTrackId(activeIds[0] ?? null);
      if (subscriptionRow) {
        setBilling({ status: subscriptionRow.status, planName: (subscriptionRow as any).plans?.name ?? 'Plan' });
      }
      setLoadState('ready');
    })();
  }, []);

  async function handleSaveTrack() {
    if (!selectedTrackId || selectedTrackId === activeProgramIds[0]) return;
    setTrackSaveState('saving');
    setTrackError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setTrackSaveState('error');
      setTrackError('Not signed in.');
      return;
    }
    const { error: enrollError } = await supabase
      .from('program_enrollments')
      .upsert({ profile_id: user.id, program_id: selectedTrackId, active: true }, { onConflict: 'profile_id,program_id' });
    if (enrollError) {
      setTrackSaveState('error');
      setTrackError(enrollError.message);
      return;
    }
    // Single-track assumption (matches onboarding): switching sets the new
    // one active and retires whatever else this athlete was active in.
    const otherActiveIds = activeProgramIds.filter((id) => id !== selectedTrackId);
    if (otherActiveIds.length > 0) {
      const { error: deactivateError } = await supabase
        .from('program_enrollments')
        .update({ active: false })
        .eq('profile_id', user.id)
        .in('program_id', otherActiveIds);
      if (deactivateError) {
        setTrackSaveState('error');
        setTrackError(deactivateError.message);
        return;
      }
    }
    setActiveProgramIds([selectedTrackId]);
    setTrackSaveState('saved');
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setProfileState('saving');
    setProfileError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setProfileState('error');
      setProfileError('Not signed in.');
      return;
    }
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim(), timezone: timezone.trim() || 'UTC' })
      .eq('id', user.id);
    if (updateError) {
      setProfileState('error');
      setProfileError(updateError.message);
      return;
    }
    setProfileState('saved');
  }

  // Uploads to the `avatars` storage bucket under <user.id>/, then writes
  // the public URL onto profiles.avatar_url. Bucket is public-read with
  // owner-only write policies keyed on the first path segment (see
  // supabase/migrations -- storage policies aren't file-based like the rest
  // of the schema, they were applied directly via the SQL editor).
  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    setAvatarError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setAvatarUploading(false);
      setAvatarError('Not signed in.');
      return;
    }
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${user.id}/avatar.${ext}`;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (uploadError) {
      setAvatarUploading(false);
      setAvatarError(uploadError.message);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = `${publicUrlData.publicUrl}?t=${Date.now()}`;
    const { error: updateError } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id);
    if (updateError) {
      setAvatarUploading(false);
      setAvatarError(updateError.message);
      return;
    }
    setAvatarUrl(url);
    setAvatarUploading(false);
  }

  // Lets an account that only ever signed in via magic link set a password,
  // so future sign-ins on /login can use the password tab instead of
  // waiting on email each time. Supabase's updateUser() works on the
  // currently authenticated session regardless of how that session was
  // established, so this doesn't care whether the athlete got here via
  // link or password.
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordState('saving');
    setPasswordError(null);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setPasswordState('error');
      setPasswordError(updateError.message);
      return;
    }
    setNewPassword('');
    setPasswordState('saved');
  }

  // Hits app/api/stripe/cancel rather than calling Stripe from the client
  // (the secret key is server-only). That route cancels immediately in
  // Stripe; the existing webhook (customer.subscription.deleted) is what
  // actually flips subscriptions.status to 'canceled' in the DB, so the
  // local billing state here is just an optimistic update for the UI --
  // a page refresh will show whatever the webhook settled on.
  async function handleCancelSubscription() {
    setCancelState('canceling');
    setCancelError(null);
    try {
      const res = await fetch('/api/stripe/cancel', { method: 'POST' });
      let body: { error?: string } = {};
      try {
        body = await res.json();
      } catch {
        // Non-JSON error body -- fall through to the generic message below.
      }
      if (!res.ok) {
        setCancelState('error');
        setCancelError(body.error ?? `Request failed (${res.status}).`);
        return;
      }
      setBilling((prev) => (prev ? { ...prev, status: 'canceled' } : prev));
      setCancelState('idle');
    } catch (err) {
      setCancelState('error');
      setCancelError(err instanceof Error ? err.message : 'Network error.');
    }
  }

  // Gated by typing DELETE first -- this is permanent (every table
  // referencing profiles cascades on delete, see app/api/account/delete/route.ts),
  // so a single misclick shouldn't be enough to do it. Signs out and bounces
  // to the marketing/login page immediately after, since the session's JWT
  // otherwise stays valid until it naturally expires even though the
  // underlying account is gone.
  async function handleDeleteAccount() {
    if (deleteAccountConfirmText.trim() !== 'DELETE') return;
    setDeleteAccountState('deleting');
    setDeleteAccountError(null);
    try {
      const res = await fetch('/api/account/delete', { method: 'POST' });
      let body: { error?: string } = {};
      try {
        body = await res.json();
      } catch {
        // Non-JSON error body -- fall through to the generic message below.
      }
      if (!res.ok) {
        setDeleteAccountState('error');
        setDeleteAccountError(body.error ?? `Request failed (${res.status}).`);
        return;
      }
      const supabase = createClient();
      await supabase.auth.signOut();
      window.location.href = '/';
    } catch (err) {
      setDeleteAccountState('error');
      setDeleteAccountError(err instanceof Error ? err.message : 'Network error.');
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
      <TopBar />
      <div className="hw-wrap" style={{ paddingTop: 90, paddingBottom: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
          <LogoutButton />
        </div>
        <div className="hw-h1" style={{ fontSize: 26, marginTop: 12 }}>Account</div>

        <form onSubmit={handleSaveProfile} className="hw-card" style={{ marginTop: 16 }}>
          <span className="hw-h3">Profile</span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12 }}>
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                border: '2px solid var(--hw-ink)',
                background: avatarUrl ? `center/cover no-repeat url(${avatarUrl})` : 'var(--hw-violet)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                overflow: 'hidden',
                font: '700 22px/1 "Space Grotesk", sans-serif',
              }}
            >
              {!avatarUrl && (displayName.trim().charAt(0).toUpperCase() || '?')}
            </div>
            <div>
              <label
                className="hw-btn hw-btn-dark"
                style={{ width: 'auto', padding: '8px 16px', fontSize: 12, cursor: avatarUploading ? 'default' : 'pointer', display: 'inline-block', position: 'relative' }}
              >
                {avatarUploading ? 'Uploading…' : 'Change photo'}
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                  disabled={avatarUploading}
                  style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
                />
              </label>
              {avatarError && <p className="hw-error" style={{ fontSize: 12, marginTop: 6 }}>{avatarError}</p>}
            </div>
          </div>

          <span className="hw-label" style={{ display: 'block', marginTop: 16 }}>Display name</span>
          <input
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
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
          <span className="hw-label" style={{ display: 'block', marginTop: 12 }}>Timezone</span>
          <input
            type="text"
            placeholder="America/New_York"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
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
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="submit"
              disabled={profileState === 'saving'}
              className="hw-btn hw-btn-dark"
              style={{ width: 'auto', padding: '10px 18px', fontSize: 13 }}
            >
              {profileState === 'saving' ? 'Saving…' : 'Save profile'}
            </button>
            {profileState === 'saved' && <span className="hw-pill hw-pill-cyan">Saved</span>}
            {profileState === 'error' && profileError && (
              <span className="hw-error" style={{ fontSize: 12 }}>{profileError}</span>
            )}
          </div>
        </form>

        <div className="hw-card" style={{ marginTop: 12 }}>
          <span className="hw-h3">Billing</span>
          {billing ? (
            <p style={{ marginTop: 8, fontSize: 13 }}>
              {billing.planName} — <span className="hw-pill hw-pill-outline">{billing.status}</span>
            </p>
          ) : (
            <p className="hw-muted" style={{ marginTop: 8, fontSize: 13 }}>No active plan.</p>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
            <Link href="/billing" className="hw-link-back" style={{ display: 'inline-block' }}>
              Manage billing →
            </Link>
            {billing && ['trialing', 'active', 'past_due'].includes(billing.status) && (
              <button
                type="button"
                onClick={handleCancelSubscription}
                disabled={cancelState === 'canceling'}
                className="hw-btn"
                style={{ width: 'auto', padding: '7px 14px', fontSize: 12, border: '2px solid var(--hw-pink-deep)', color: 'var(--hw-pink-deep)' }}
              >
                {cancelState === 'canceling' ? 'Canceling…' : 'Cancel subscription'}
              </button>
            )}
          </div>
          {cancelState === 'error' && cancelError && (
            <p className="hw-error" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>{cancelError}</p>
          )}
        </div>
      </div>

      <div className="hw-wrap" style={{ paddingTop: 0 }}>
        <div className="hw-card" style={{ marginTop: 12 }}>
          <span className="hw-h3" style={{ fontSize: 15 }}>Your track</span>
          <p className="hw-muted" style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>
            Which program shows up on your board every morning.
          </p>
          {tracks.length === 0 ? (
            <p className="hw-muted" style={{ margin: 0, fontSize: 13 }}>No tracks are set up yet — ask your coach.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {tracks.map((t) => {
                const selected = selectedTrackId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedTrackId(t.id)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      border: selected ? '3px solid var(--hw-pink)' : '2px solid var(--hw-ink)',
                      borderRadius: 8,
                      background: selected ? 'var(--hw-violet)' : 'var(--hw-paper)',
                      color: selected ? 'var(--hw-paper)' : 'var(--hw-ink)',
                      font: '700 13px/1 "Space Grotesk", sans-serif',
                      cursor: 'pointer',
                    }}
                  >
                    {selected ? '✓ ' : ''}{t.name}
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={handleSaveTrack}
              disabled={trackSaveState === 'saving' || !selectedTrackId || selectedTrackId === activeProgramIds[0]}
              className="hw-btn hw-btn-dark"
              style={{
                width: 'auto',
                padding: '10px 18px',
                fontSize: 13,
                opacity: !selectedTrackId || selectedTrackId === activeProgramIds[0] ? 0.6 : 1,
              }}
            >
              {trackSaveState === 'saving' ? 'Saving…' : 'Save changes'}
            </button>
            {trackSaveState === 'saved' && <span className="hw-pill hw-pill-cyan">Saved</span>}
            {trackSaveState === 'error' && trackError && (
              <span className="hw-error" style={{ fontSize: 12 }}>{trackError}</span>
            )}
          </div>
        </div>
      </div>

      <div className="hw-wrap" style={{ paddingTop: 0, paddingBottom: 100 }}>
        <form onSubmit={handleSetPassword} className="hw-card" style={{ marginTop: 4, marginBottom: 24 }}>
          <span className="hw-eyebrow">Password sign-in</span>
          <p className="hw-muted" style={{ fontSize: 13, marginTop: 6 }}>
            Set a password to sign in faster next time, instead of waiting on an email link.
          </p>
          <input
            type="password"
            required
            minLength={6}
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
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
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="submit"
              disabled={passwordState === 'saving'}
              className="hw-btn hw-btn-dark"
              style={{ width: 'auto', padding: '10px 18px', fontSize: 13 }}
            >
              {passwordState === 'saving' ? 'Saving…' : 'Set password'}
            </button>
            {passwordState === 'saved' && <span className="hw-pill hw-pill-cyan">Saved</span>}
            {passwordState === 'error' && passwordError && (
              <span className="hw-error" style={{ fontSize: 12 }}>{passwordError}</span>
            )}
          </div>
        </form>

        <div className="hw-card" style={{ marginBottom: 24, border: '2px solid var(--hw-pink-deep)' }}>
          <span className="hw-eyebrow" style={{ color: 'var(--hw-pink-deep)' }}>Delete account</span>
          <p className="hw-muted" style={{ fontSize: 13, marginTop: 6 }}>
            Permanently deletes your account -- scores, PRs, posts, everything. This can&apos;t be undone.
            Type <strong>DELETE</strong> to confirm.
          </p>
          <input
            type="text"
            value={deleteAccountConfirmText}
            onChange={(e) => setDeleteAccountConfirmText(e.target.value)}
            placeholder="DELETE"
            style={{
              display: 'block',
              width: '100%',
              marginTop: 10,
              font: '700 14px/1 "Space Grotesk", sans-serif',
              padding: '12px 14px',
              border: '2px solid var(--hw-pink-deep)',
              borderRadius: 8,
              background: 'var(--hw-paper)',
              color: 'var(--hw-ink)',
            }}
          />
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              onClick={handleDeleteAccount}
              disabled={deleteAccountState === 'deleting' || deleteAccountConfirmText.trim() !== 'DELETE'}
              className="hw-btn"
              style={{ width: 'auto', padding: '10px 18px', fontSize: 13, background: 'var(--hw-pink-deep)', color: 'var(--hw-paper)' }}
            >
              {deleteAccountState === 'deleting' ? 'Deleting…' : 'Delete my account'}
            </button>
            {deleteAccountState === 'error' && deleteAccountError && (
              <span className="hw-error" style={{ fontSize: 12 }}>{deleteAccountError}</span>
            )}
          </div>
        </div>
      </div>
      <TabBar />
    </main>
  );
}
