// Browser-side Supabase client -- for client components only ("use client").
// Uses the anon key, so every query through this client is subject to RLS
// (20260903150000_row_level_security.sql) exactly as an athlete's own
// browser session should be.

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '../db/types';

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
