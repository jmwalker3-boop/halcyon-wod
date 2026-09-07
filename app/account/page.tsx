'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import LogoutButton from '@/components/LogoutButton';
import { createClient } from '@/lib/supabase/client';
import { EQUIPMENT_OPTIONS, SKILL_CATEGORIES, LEVELS, type SkillCategoryKey, type SkillLevelValue } from '@/lib/equipment';

// Consolidated account hub (John's request, 2026-09-07: "we should have an
// 'account' page, too, for athletes" -- and when asked how far to take it,
// "consolidate everything"). Replaces /settings as the main athlete-facing
// settings surface: everything that page had (gear, skill level, password)
// lives here too, plus two things that had no UI anywhere before now --
// profile basics (profiles.display_name/timezone, columns that existed
// since the very first migration but were never editable) and a compact
// billing summary linking out to /billing rather than duplicating that
// page's checkout logic here. /settings itself now just redirects here
// (see app/settings/page.tsx) so no existing link/bookmark breaks.
// Equipment/skill constants live in lib/equipment.ts -- shared with
// app/onboarding, which needs the exact same 21 tags and 6 categories.

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

  const [equipment, setEquipment] = useState<Set<string>>(new Set());
  const [skillLevels, setSkillLevels] = useState<Record<string, SkillLevelValue>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');

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
        { data: equipmentRows, error: equipmentError },
        { data: skillRows, error: skillError },
        { data: subscriptionRow },
      ] = await Promise.all([
        supabase.from('profiles').select('display_name, avatar_url, timezone').eq('id', user.id).single(),
        supabase.from('profile_equipment').select('equipment_tag').eq('profile_id', user.id),
        supabase.from('profile_skill_levels').select('skill_category, level').eq('profile_id', user.id),
        supabase
          .from('subscriptions')
          .select('status, plans ( name )')
          .eq('profile_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (profileFetchError || equipmentError || skillError) {
        setError((profileFetchError ?? equipmentError ?? skillError)!.message);
        setLoadState('error');
        return;
      }

      setDisplayName(profileRow?.display_name ?? '');
      setAvatarUrl(profileRow?.avatar_url ?? null);
      setTimezone(profileRow?.timezone ?? 'UTC');
      setEquipment(new Set((equipmentRows ?? []).map((r: any) => r.equipment_tag)));
      setSkillLevels(Object.fromEntries((skillRows ?? []).map((r: any) => [r.skill_category, r.level])));
      if (subscriptionRow) {
        setBilling({ status: subscriptionRow.status, planName: (subscriptionRow as any).plans?.name ?? 'Plan' });
      }
      setLoadState('ready');
    })();
  }, []);

  function toggleEquipment(tag: string) {
    setEquipment((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
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

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveState('saving');
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError('Not signed in.');
      setSaveState('error');
      return;
    }

    // Equipment: full replace. Two round trips (delete, then insert) rather
    // than a diff -- simpler and correct for a checkbox-set form; this table
    // has no other per-row data worth preserving.
    const { error: deleteError } = await supabase.from('profile_equipment').delete().eq('profile_id', user.id);
    if (deleteError) {
      setError(deleteError.message);
      setSaveState('error');
      return;
    }
    if (equipment.size > 0) {
      const { error: insertError } = await supabase
        .from('profile_equipment')
        .insert([...equipment].map((equipment_tag) => ({ profile_id: user.id, equipment_tag })));
      if (insertError) {
        setError(insertError.message);
        setSaveState('error');
        return;
      }
    }

    // Skill levels: upsert one row per category that has a non-default
    // value recorded. Categories left at 'rx' just don't get a row --
    // resolveMovementForAthlete already treats "no row" as rx.
    const skillRowsToSave = SKILL_CATEGORIES.filter((c) => skillLevels[c.key] && skillLevels[c.key] !== 'rx').map((c) => ({
      profile_id: user.id,
      skill_category: c.key,
      level: skillLevels[c.key] as SkillLevelValue,
      updated_at: new Date().toISOString(),
    }));
    const rxCategories: SkillCategoryKey[] = SKILL_CATEGORIES.filter(
      (c) => !skillLevels[c.key] || skillLevels[c.key] === 'rx',
    ).map((c) => c.key);

    const [{ error: upsertError }, { error: deleteRxError }] = await Promise.all([
      skillRowsToSave.length > 0
        ? supabase.from('profile_skill_levels').upsert(skillRowsToSave, { onConflict: 'profile_id,skill_category' })
        : Promise.resolve({ error: null }),
      rxCategories.length > 0
        ? supabase.from('profile_skill_levels').delete().eq('profile_id', user.id).in('skill_category', rxCategories)
        : Promise.resolve({ error: null }),
    ]);
    if (upsertError || deleteRxError) {
      setError((upsertError ?? deleteRxError)!.message);
      setSaveState('error');
      return;
    }

    setSaveState('saved');
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
      <div className="hw-wrap" style={{ paddingBottom: 0 }}>
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

      <form onSubmit={handleSave} className="hw-wrap" style={{ paddingTop: 0 }}>
        <div className="hw-card" style={{ marginTop: 12 }}>
          <div className="hw-eyebrow-row">
            <span className="hw-h3">Your gear</span>
            <span className="hw-pill hw-pill-outline">{equipment.size} of {EQUIPMENT_OPTIONS.length}</span>
          </div>
          <p className="hw-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Check what you actually have. Anything you skip gets scaled around automatically, where a swap exists.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {EQUIPMENT_OPTIONS.map((opt) => {
              const on = equipment.has(opt.tag);
              return (
                <label
                  key={opt.tag}
                  className={`hw-chip${on ? ' hw-chip-on' : ''}`}
                  style={{ cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleEquipment(opt.tag)}
                    style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }}
                  />
                  {on ? '✓ ' : ''}
                  {opt.label.toUpperCase()}
                </label>
              );
            })}
          </div>
        </div>

        <div className="hw-card" style={{ marginTop: 12 }}>
          <span className="hw-h3">Skill level</span>
          <p className="hw-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Rx is the default. Only move one of these if you&apos;re not doing it as written yet.
          </p>
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {SKILL_CATEGORIES.map((cat) => {
              const value = skillLevels[cat.key] ?? 'rx';
              return (
                <div key={cat.key}>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    {cat.label}
                    {cat.hint && <span className="hw-muted" style={{ fontWeight: 400 }}> — {cat.hint}</span>}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      marginTop: 8,
                      border: '3px solid var(--hw-ink)',
                      borderRadius: 999,
                      overflow: 'hidden',
                    }}
                  >
                    {LEVELS.map((lvl, i) => (
                      <button
                        key={lvl.value}
                        type="button"
                        onClick={() => setSkillLevels((prev) => ({ ...prev, [cat.key]: lvl.value as SkillLevelValue }))}
                        style={{
                          flex: 1,
                          border: 'none',
                          borderLeft: i > 0 ? '3px solid var(--hw-ink)' : 'none',
                          padding: '11px 0',
                          font: '700 10px/1 "Space Mono", monospace',
                          color: value === lvl.value && lvl.value !== 'rx' ? 'var(--hw-ink)' : 'var(--hw-ink)',
                          background:
                            value === lvl.value
                              ? lvl.value === 'rx'
                                ? 'var(--hw-violet)'
                                : lvl.value === 'intermediate'
                                  ? 'var(--hw-cyan)'
                                  : 'var(--hw-orange)'
                              : 'var(--hw-paper)',
                          cursor: 'pointer',
                        }}
                      >
                        {lvl.value.slice(0, 3).toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="hw-sticky-bar">
          <span className="hw-label" style={{ flex: 1 }}>
            {saveState === 'saved' ? 'SAVED' : saveState === 'error' ? 'SAVE FAILED' : 'REVIEW & SAVE'}
          </span>
          <button type="submit" disabled={saveState === 'saving'} className="hw-btn hw-btn-dark" style={{ width: 'auto', padding: '13px 22px' }}>
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
        {saveState === 'error' && error && (
          <p className="hw-error" style={{ padding: '0 0 20px' }}>{error}</p>
        )}
      </form>

      {/* Separate form, deliberately outside the equipment/skill form above --
          this saves to auth, not to profile_equipment or profile_skill_levels, so it
          has its own submit action and its own save state. */}
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
    </main>
  );
}
