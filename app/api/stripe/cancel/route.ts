// POST /api/stripe/cancel
//
// Lets an athlete cancel their own subscription from /account (John's
// request, 2026-09-07). Cancels immediately in Stripe rather than at
// period end -- the webhook's existing customer.subscription.deleted
// handler (app/api/stripe/webhook/route.ts) already flips
// subscriptions.status to 'canceled', so this route only has to ask
// Stripe to cancel; the DB update path is already wired.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';
import { getPool } from '@/lib/db/pool';

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `select stripe_subscription_id from subscriptions where profile_id = $1 and status in ('trialing', 'active', 'past_due') order by created_at desc limit 1`,
    [user.id],
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: 'No active subscription found.' }, { status: 404 });
  }

  const stripe = getStripe();
  try {
    await stripe.subscriptions.cancel(rows[0].stripe_subscription_id);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

