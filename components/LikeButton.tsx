'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export default function LikeButton({
  postId,
  initialLiked,
  initialCount,
}: {
  postId: string;
  initialLiked: boolean;
  initialCount: number;
}) {
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setBusy(false);
      return;
    }

    if (liked) {
      await supabase.from('reactions').delete().eq('post_id', postId).eq('profile_id', user.id).eq('type', 'like');
      setLiked(false);
      setCount((c) => Math.max(0, c - 1));
    } else {
      await supabase.from('reactions').insert({ post_id: postId, profile_id: user.id, type: 'like' });
      setLiked(true);
      setCount((c) => c + 1);
    }
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={liked ? 'hw-pill hw-pill-dark' : 'hw-pill hw-pill-outline'}
      style={{
        cursor: 'pointer',
        border: liked ? 'none' : undefined,
        opacity: liked ? 1 : 0.55,
        boxShadow: liked ? '3px 3px 0 var(--hw-pink)' : '3px 3px 0 var(--hw-ink)',
      }}
    >
      🤙 {count}
    </button>
  );
}
