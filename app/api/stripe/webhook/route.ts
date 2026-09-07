// POST /api/stripe/webhook
//
// Handles the three subscription lifecycle events plans/subscriptions
// actually needs (see 20260903150000_row_level_security.sql's comment:
// "all writes are service_role (Stripe webhook) only" -- there's no
// insert/update policy for authenticated/anon on either table, by design).
// Writes go through the same RLS-bypassing direct Postgres pool the
// admin/set-password route uses, not the anon-key Supabase client.
//
// Signature verification needs the RAW request body -- request.json() would
// re-serialize it and break the signature, so this reads request.text()
// first and hands that to stripe.webhooks.constructEvent.
import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getStripe } from '@/lib/stripe';
import { getPool } from '@/lib/db/pool';

async function upsertSubscription(stripe: Stripe, subscriptionId: string, profileId?: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const priceId = subscription.items.data[0]?.price.id;
  const pool = getPool();

  const { rows: planRows } = await pool.query('select id from plans where stripe_price_id = $1', [priceId]);
  if (planRows.length === 0) {
    throw new Error(`No plan configured for Stripe price ${priceId}`);
  }
  const planId = planRows[0].id;
  const currentPeriodEnd = (subscription as any).current_period_end
    ? new Date((subscription as any).current_period_end * 1000).toISOString()
    : null;

  if (profileId) {
    await pool.query(
      `insert into subscriptions (profile_id, plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_end)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (stripe_subscription_id) do update
         set plan_id = excluded.plan_id, status = excluded.status, current_period_end = excluded.current_period_end`,
      [profileId, planId, subscription.customer as string, subscription.id, subscription.status, currentPeriodEnd],
    );
  } else {
    await pool.query(
      `update subscriptions set plan_id = $1, status = $2, current_period_end = $3 where stripe_subscription_id = $4`,
      [planId, subscription.status, currentPeriodEnd, subscription.id],
    );
  }
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const signature = request.headers.get('stripe-signature');
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature!, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    return NextResponse.json({ error: `Signature verification failed: ${(err as Error).message}` }, { status: 400 });
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription && session.client_reference_id) {
        await upsertSubscription(stripe, session.subscription as string, session.client_reference_id);
      }
    } else if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as Stripe.Subscription;
      await upsertSubscription(stripe, subscription.id);
    }
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

