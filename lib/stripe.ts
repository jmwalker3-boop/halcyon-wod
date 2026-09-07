// Server-side Stripe client -- same "lazy singleton" shape as lib/db/pool.ts.
// Never import this into a client component; STRIPE_SECRET_KEY is a
// server-only secret.

import Stripe from 'stripe';

let stripe: Stripe | undefined;

export function getStripe(): Stripe {
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  }
  return stripe;
}

