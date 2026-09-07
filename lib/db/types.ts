// Hand-authored, PARTIAL Supabase Database type -- covers only the tables
// this skeleton actually queries (profiles, program_enrollments, programs,
// program_cycles, calendar_slots, workouts, workout_segments,
// workout_movements, movements). The real schema has 27 tables (see
// supabase/migrations/) -- once there's a live Supabase project, replace
// this whole file with the generated one:
//
//   npx supabase gen types typescript --project-id <ref> > lib/db/types.ts
//
// Hand-typing this now was a deliberate shortcut to get the skeleton
// building without a live project to generate against -- don't hand-edit
// it further once the generated version exists, or the two will drift.
//
// Every table needs a `Relationships` array (empty is fine here) and the
// schema needs `Views`/`Functions` keys even if empty -- @supabase/postgrest-js's
// generic type resolution silently collapses every query result to `never`
// without them, which is a confusing failure mode if you don't already know
// to look for it (found by `next build` actually type-checking the
// dashboard/API route against this file, not by inspection).

export type ProfileRole = 'athlete' | 'coach' | 'admin';
export type DayType = 'Training' | 'Skill' | 'Recovery';
export type SegmentType = 'warmup' | 'skill' | 'strength' | 'metcon' | 'accessory';
export type Modality = 'M' | 'G' | 'W';
export type ScalingTier = 'intermediate' | 'beginner';
export type AthleteSkillLevel = 'rx' | 'intermediate' | 'beginner';
export type SkillCategory = 'pull_up_bar' | 'rings' | 'handstand' | 'hanging_core' | 'rope_climb' | 'pistol';
export type ResultType = 'time' | 'rounds_reps' | 'load' | 'cals' | 'reps';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; role: ProfileRole; display_name: string | null; avatar_url: string | null; timezone: string };
        Insert: { id: string; role?: ProfileRole; display_name?: string | null; avatar_url?: string | null; timezone?: string };
        Update: Partial<{ role: ProfileRole; display_name: string | null; avatar_url: string | null; timezone: string }>;
        Relationships: [];
      };
      programs: {
        Row: { id: string; name: string; owner_id: string };
        Insert: { id?: string; name: string; owner_id: string };
        Update: Partial<{ name: string; owner_id: string }>;
        Relationships: [];
      };
      program_cycles: {
        Row: { id: string; program_id: string; start_date: string; length_days: number; format_pattern: string };
        Insert: { id?: string; program_id: string; start_date: string; length_days: number; format_pattern?: string };
        Update: Partial<{ start_date: string; length_days: number; format_pattern: string }>;
        Relationships: [];
      };
      program_enrollments: {
        Row: { profile_id: string; program_id: string; joined_at: string; active: boolean };
        Insert: { profile_id: string; program_id: string; joined_at?: string; active?: boolean };
        Update: Partial<{ active: boolean }>;
        Relationships: [];
      };
      calendar_slots: {
        Row: {
          id: string;
          program_cycle_id: string;
          training_block_id: string | null;
          slot_in_block: number | null;
          date: string;
          day_type: DayType;
          target_modalities: Modality[];
          workout_id: string | null;
          override_reason: string | null;
        };
        Insert: Partial<Database['public']['Tables']['calendar_slots']['Row']> & {
          program_cycle_id: string;
          date: string;
          day_type: DayType;
        };
        Update: Partial<Database['public']['Tables']['calendar_slots']['Row']>;
        Relationships: [];
      };
      workouts: {
        Row: {
          id: string;
          title: string | null;
          day_type: DayType | null;
          raw_text: string | null;
          is_benchmark: boolean;
          coach_notes: string | null;
          scaling_notes: string | null;
        };
        Insert: Partial<Database['public']['Tables']['workouts']['Row']> & { id?: string };
        Update: Partial<Database['public']['Tables']['workouts']['Row']>;
        Relationships: [];
      };
      workout_segments: {
        Row: { id: string; workout_id: string; segment_type: SegmentType; order_index: number };
        Insert: { id?: string; workout_id: string; segment_type: SegmentType; order_index: number };
        Update: Partial<{ segment_type: SegmentType; order_index: number }>;
        Relationships: [];
      };
      workout_movements: {
        Row: { id: string; workout_id: string; segment_id: string | null; movement_id: string; order_index: number };
        Insert: { id?: string; workout_id: string; segment_id?: string | null; movement_id: string; order_index: number };
        Update: Partial<{ segment_id: string | null; order_index: number }>;
        Relationships: [];
      };
      movements: {
        Row: {
          id: string;
          canonical_name: string;
          modality: Modality;
          equipment: string[];
          skill_category: SkillCategory | null;
        };
        Insert: { id?: string; canonical_name: string; modality: Modality; equipment?: string[]; skill_category?: SkillCategory | null };
        Update: Partial<{ canonical_name: string; modality: Modality; equipment: string[]; skill_category: SkillCategory | null }>;
        Relationships: [];
      };
      movement_scales: {
        Row: { id: string; movement_id: string; tier: ScalingTier; scale_movement_id: string; rationale: string };
        Insert: { id?: string; movement_id: string; tier: ScalingTier; scale_movement_id: string; rationale: string };
        Update: never;
        Relationships: [];
      };
      movement_equipment_substitutes: {
        Row: { id: string; movement_id: string; substitute_id: string; rationale: string };
        Insert: { id?: string; movement_id: string; substitute_id: string; rationale: string };
        Update: never;
        Relationships: [];
      };
      profile_equipment: {
        Row: { id: string; profile_id: string; equipment_tag: string; notes: string | null };
        Insert: { id?: string; profile_id: string; equipment_tag: string; notes?: string | null };
        Update: Partial<{ equipment_tag: string; notes: string | null }>;
        Relationships: [];
      };
      profile_equipment_loads: {
        Row: { id: string; profile_id: string; equipment_tag: string; load_value: number; unit: 'lb' | 'kg'; quantity: number };
        Insert: { id?: string; profile_id: string; equipment_tag: string; load_value: number; unit?: 'lb' | 'kg'; quantity?: number };
        Update: Partial<{ equipment_tag: string; load_value: number; unit: 'lb' | 'kg'; quantity: number }>;
        Relationships: [];
      };
      profile_skill_levels: {
        Row: { id: string; profile_id: string; skill_category: SkillCategory; level: AthleteSkillLevel; updated_at: string };
        Insert: { id?: string; profile_id: string; skill_category: SkillCategory; level?: AthleteSkillLevel; updated_at?: string };
        Update: Partial<{ level: AthleteSkillLevel; updated_at: string }>;
        Relationships: [];
      };
      plans: {
        Row: { id: string; name: string; stripe_price_id: string; interval: 'month' | 'year'; amount_cents: number };
        Insert: { id?: string; name: string; stripe_price_id: string; interval: 'month' | 'year'; amount_cents: number };
        Update: never;
        Relationships: [];
      };
      subscriptions: {
        Row: {
          id: string;
          profile_id: string;
          plan_id: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          status: 'trialing' | 'active' | 'past_due' | 'canceled';
          current_period_end: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          plan_id: string;
          stripe_customer_id: string;
          stripe_subscription_id: string;
          status: 'trialing' | 'active' | 'past_due' | 'canceled';
          current_period_end?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      workout_logs: {
        Row: {
          id: string;
          profile_id: string;
          calendar_slot_id: string | null;
          workout_id: string;
          movement_id: string | null;
          result_type: ResultType;
          result_value: Record<string, unknown>;
          rpe: number | null;
          performed_at: string;
          // Added 20260907180000_workout_logs_result_tier.sql -- the
          // scaling tier this score was logged under (rx/intermediate/
          // beginner), so the leaderboard can filter and badge by silo.
          // Defaults to 'rx' on the column, so every pre-migration row
          // reads as 'rx' whether or not that was actually true.
          result_tier: AthleteSkillLevel;
        };
        Insert: {
          id?: string;
          profile_id: string;
          calendar_slot_id?: string | null;
          workout_id: string;
          movement_id?: string | null;
          result_type: ResultType;
          result_value: Record<string, unknown>;
          rpe?: number | null;
          performed_at?: string;
          result_tier?: AthleteSkillLevel;
        };
        Update: never;
        Relationships: [];
      };
      personal_records: {
        Row: {
          id: string;
          profile_id: string;
          movement_id: string;
          record_type: string;
          value: number;
          achieved_at: string;
          workout_log_id: string | null;
        };
        Insert: {
          id?: string;
          profile_id: string;
          movement_id: string;
          record_type: string;
          value: number;
          achieved_at: string;
          workout_log_id?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      posts: {
        Row: { id: string; profile_id: string; body: string; media_url: string | null; workout_log_id: string | null; created_at: string };
        Insert: { id?: string; profile_id: string; body: string; media_url?: string | null; workout_log_id?: string | null };
        Update: never;
        Relationships: [];
      };
      comments: {
        Row: { id: string; post_id: string; profile_id: string; body: string; created_at: string };
        Insert: { id?: string; post_id: string; profile_id: string; body: string };
        Update: never;
        Relationships: [];
      };
      reactions: {
        Row: { id: string; post_id: string | null; comment_id: string | null; workout_log_id: string | null; profile_id: string; type: string; created_at: string };
        Insert: { id?: string; post_id?: string | null; comment_id?: string | null; workout_log_id?: string | null; profile_id: string; type: string };
        Update: never;
        Relationships: [];
      };
      messages: {
        Row: { id: string; profile_id: string; body: string; created_at: string };
        Insert: { id?: string; profile_id: string; body: string; created_at?: string };
        Update: never;
        Relationships: [];
      };
      generation_drafts: {
        Row: { id: string; generation_request_id: string; draft_text: string; draft_sequence: unknown; model_used: string };
        Insert: { id?: string; generation_request_id: string; draft_text: string; draft_sequence: unknown; model_used: string };
        Update: never;
        Relationships: [];
      };
      validation_results: {
        Row: { id: string; generation_draft_id: string; passed: boolean; errors: unknown; validated_at: string };
        Insert: { id?: string; generation_draft_id: string; passed: boolean; errors: unknown };
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // SECURITY DEFINER, admin-gated internally (see the migration) -- looks
      // up an auth.users email and upserts a program_enrollments row for the
      // one program that exists (2026-09-06, "everyone will be on the
      // program initially," no picker needed until a second program does).
      admin_enroll_by_email: {
        Args: { target_email: string };
        Returns: undefined;
      };
      // Same is_admin()-gated SECURITY DEFINER shape as admin_enroll_by_email
      // (see 20260907150000_admin_unenroll.sql) -- flips program_enrollments.active
      // instead of inserting a new row.
      admin_set_enrollment_active: {
        Args: { target_profile_id: string; is_active: boolean };
        Returns: undefined;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
