// POST /api/stripe/checkout  { interval: 'month' | 'year' }
//
// Creates a Stripe Checkout session for the signed-in athlete and returns
// its URL for the client to redirect to. client_reference_id carries the
// profile id through Checkout so the webhook (which has no session/cookie
// context) can map the resulting subscription back to a profile without
// guessing by email. 14-day trial is set here (subscription_data), not as
// a Stripe "Trial" object on the price -- keeps trial length a checkout-time
// decision rather than baked into the price itself.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getStripe } from '@/lib/stripe';

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { interval } = await request.json();
  if (interval !== 'month' && interval !== 'year') {
    return NextResponse.json({ error: 'Invalid interval.' }, { status: 400 });
  }

  const { data: plan } = await supabase.from('plans').select('stripe_price_id').eq('interval', interval).single();
  if (!plan) {
    return NextResponse.json({ error: 'No plan configured for that interval.' }, { status: 500 });
  }

  const origin = request.headers.get('origin') ?? new URL(request.url).origin;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: user.email,
    client_reference_id: user.id,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    subscription_data: { trial_period_days: 14 },
    success_url: `${origin}/billing?success=1`,
    cancel_url: `${origin}/billing?canceled=1`,
  });

  return NextResponse.json({ url: session.url });
}

