'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import Avatar from '@/components/Avatar';
import TabBar from '@/components/TabBar';

// One shared channel, no DMs/rooms/typing indicators -- John's call
// (2026-09-07): "nothing more elaborate than a Discord server's chat."
// Realtime (postgres_changes on messages, enabled via the
// 20260907130000_shared_chat.sql migration's `alter publication
// supabase_realtime add table messages`) pushes new rows to every open
// tab without a refresh -- a chat that only updates on reload isn't
// really a chat. Realtime payloads are the raw row only (no join), so
// profile display_name/avatar_url are cached locally from the initial
// fetch and topped up per-sender the first time a new sender's message
// arrives.
type Profile = { display_name: string | null; avatar_url: string | null };
type Message = { id: string; profile_id: string; body: string; created_at: string };

export default function ChatPage() {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError('Not signed in.');
        setLoadState('error');
        return;
      }
      setMyId(user.id);

      const { data, error: fetchError } = await supabase
        .from('messages')
        .select('id, profile_id, body, created_at, profiles ( display_name, avatar_url )')
        .order('created_at', { ascending: true })
        .limit(200);
      if (fetchError) {
        setError(fetchError.message);
        setLoadState('error');
        return;
      }

      const rows = (data ?? []) as unknown as (Message & { profiles: Profile | null })[];
      const profileMap: Record<string, Profile> = {};
      for (const r of rows) {
        if (r.profiles) profileMap[r.profile_id] = r.profiles;
      }
      setProfiles(profileMap);
      setMessages(rows.map(({ profiles: _p, ...m }) => m));
      setLoadState('ready');

      channel = supabase
        .channel('messages-general')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          async (payload) => {
            const row = payload.new as Message;
            setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
            if (!profilesRef.current[row.profile_id]) {
              const { data: p } = await supabase
                .from('profiles')
                .select('display_name, avatar_url')
                .eq('id', row.profile_id)
                .single();
              if (p) setProfiles((prev) => ({ ...prev, [row.profile_id]: p }));
            }
          },
        )
        .subscribe();
    })();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !myId) return;
    setSending(true);
    const supabase = createClient();
    const { error: insertError } = await supabase.from('messages').insert({ profile_id: myId, body });
    if (!insertError) setDraft('');
    setSending(false);
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
    <>
    <main className="hw-shell" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 90px)' }}>
      <div className="hw-wrap" style={{ paddingBottom: 12, flex: 'none' }}>
        <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
        <div className="hw-h1" style={{ fontSize: 26, marginTop: 12 }}>Chat</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
        {messages.length === 0 && <p className="hw-muted">No messages yet — say hi.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((m) => {
            const p = profiles[m.profile_id];
            const mine = m.profile_id === myId;
            return (
              <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Avatar name={p?.display_name ?? 'Athlete'} url={p?.avatar_url ?? null} size={28} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>
                    {mine ? 'You' : p?.display_name ?? 'Athlete'}{' '}
                    <span className="hw-muted" style={{ fontWeight: 400 }}>
                      {new Date(m.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </div>
                  <p style={{ margin: '2px 0 0', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <form onSubmit={handleSend} style={{ flex: 'none', display: 'flex', gap: 8, padding: 16, borderTop: '2px solid var(--hw-ink)' }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the box…"
          maxLength={2000}
          style={{
            flex: 1,
            font: '700 14px/1 "Space Grotesk", sans-serif',
            padding: '12px 14px',
            border: '2px solid var(--hw-ink)',
            borderRadius: 8,
            background: 'var(--hw-paper)',
            color: 'var(--hw-ink)',
          }}
        />
        <button type="submit" disabled={sending || !draft.trim()} className="hw-btn hw-btn-dark" style={{ width: 'auto', padding: '12px 20px' }}>
          Send
        </button>
      </form>
    </main>
    <TabBar />
    </>
  );
}
