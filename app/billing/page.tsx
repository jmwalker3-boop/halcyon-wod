'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// Athlete-facing subscribe/status page. Deliberately reads subscriptions
// through the RLS-scoped browser client (read own -- see
// 20260903150000_row_level_security.sql) rather than a route handler: this
// page never WRITES to subscriptions (only the Stripe webhook does that),
// so there's no service-role work here, just a plain "read own" query.
type Subscription = {
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  current_period_end: string | null;
  plans: { name: string; interval: 'month' | 'year'; amount_cents: number } | null;
};

export default function BillingPage() {
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState<'month' | 'year' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setLoadState('error');
        return;
      }
      const { data } = await supabase
        .from('subscriptions')
        .select('status, current_period_end, plans ( name, interval, amount_cents )')
        .eq('profile_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setSubscription((data as unknown as Subscription) ?? null);
      setLoadState('ready');
    })();
  }, []);

  async function handleSubscribe(interval: 'month' | 'year') {
    setCheckoutLoading(interval);
    setError(null);
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ interval }),
    });
    const body = await res.json();
    if (!res.ok || !body.url) {
      setError(body.error ?? 'Could not start checkout.');
      setCheckoutLoading(null);
      return;
    }
    window.location.href = body.url;
  }

  const isActive = subscription && (subscription.status === 'active' || subscription.status === 'trialing');

  return (
    <main className="hw-shell">
      <div className="hw-wrap">
        <Link href="/dashboard" className="hw-link-back">← Back to today</Link>
        <div className="hw-h1" style={{ fontSize: 26 }}>Billing</div>

        {loadState === 'loading' && <p className="hw-muted" style={{ marginTop: 16 }}>Loading…</p>}

        {loadState === 'ready' && isActive && subscription && (
          <div className="hw-card" style={{ marginTop: 16 }}>
            <span className="hw-label" style={{ color: 'var(--hw-violet)' }}>
              {subscription.status === 'trialing' ? 'Free trial' : 'Active'}
            </span>
            <p style={{ marginTop: 8, fontSize: 14 }}>
              {subscription.plans?.name} — ${((subscription.plans?.amount_cents ?? 0) / 100).toFixed(2)} /{' '}
              {subscription.plans?.interval}
            </p>
            {subscription.current_period_end && (
              <p className="hw-muted" style={{ fontSize: 12, marginTop: 4 }}>
                {subscription.status === 'trialing' ? 'Trial ends' : 'Renews'}{' '}
                {new Date(subscription.current_period_end).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
        )}

        {loadState === 'ready' && !isActive && (
          <>
            <p className="hw-lede">Pick a plan — starts with a 14-day free trial.</p>
            <div className="hw-card" style={{ marginTop: 16 }}>
              <span className="hw-h3">Monthly</span>
              <p style={{ marginTop: 6, fontSize: 20, fontWeight: 700 }}>$14.99<span className="hw-muted" style={{ fontSize: 13, fontWeight: 400 }}> /month</span></p>
              <button
                type="button"
                onClick={() => handleSubscribe('month')}
                disabled={checkoutLoading !== null}
                className="hw-btn hw-btn-dark"
                style={{ marginTop: 12, fontSize: 14, padding: 12 }}
              >
                {checkoutLoading === 'month' ? 'Redirecting…' : 'Start free trial'}
              </button>
            </div>
            <div className="hw-card" style={{ marginTop: 12 }}>
              <span className="hw-h3">Yearly</span>
              <p style={{ marginTop: 6, fontSize: 20, fontWeight: 700 }}>$114.99<span className="hw-muted" style={{ fontSize: 13, fontWeight: 400 }}> /year</span></p>
              <button
                type="button"
                onClick={() => handleSubscribe('year')}
                disabled={checkoutLoading !== null}
                className="hw-btn hw-btn-mustard"
                style={{ marginTop: 12, fontSize: 14, padding: 12 }}
              >
                {checkoutLoading === 'year' ? 'Redirecting…' : 'Start free trial'}
              </button>
            </div>
          </>
        )}

        {error && <p className="hw-error" style={{ marginTop: 12 }}>{error}</p>}
      </div>
    </main>
  );
}

