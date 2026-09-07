// Shared equipment + skill-level constants -- previously duplicated inline
// in app/account/page.tsx; extracted so app/onboarding can use the exact
// same 21 tags and 6 skill categories without drifting from account's copy.
import type { SkillCategory } from '@/lib/db/types';

export const EQUIPMENT_OPTIONS: { tag: string; label: string }[] = [
  { tag: 'barbell', label: 'Barbell' },
  { tag: 'plate', label: 'Plates' },
  { tag: 'dumbbell', label: 'Dumbbells' },
  { tag: 'kettlebell', label: 'Kettlebell' },
  { tag: 'pull-up bar', label: 'Pull-up bar' },
  { tag: 'rings', label: 'Rings' },
  { tag: 'box', label: 'Plyo box' },
  { tag: 'bench', label: 'Bench' },
  { tag: 'band', label: 'Resistance band' },
  { tag: 'wall', label: 'Wall space (for wall balls / HSPU / handstand work)' },
  { tag: 'rope', label: 'Climbing rope' },
  { tag: 'jump rope', label: 'Jump rope' },
  { tag: 'med ball', label: 'Medicine ball' },
  { tag: 'sandbag', label: 'Sandbag' },
  { tag: 'ghd', label: 'GHD machine' },
  { tag: 'bike', label: 'Bike (Echo/Assault-style)' },
  { tag: 'bike erg', label: 'Bike erg' },
  { tag: 'rower', label: 'Rower' },
  { tag: 'ski erg', label: 'Ski erg' },
  { tag: 'cable', label: 'Cable machine' },
  { tag: 'pvc', label: 'PVC pipe' },
];

// Grouped for onboarding's "what've you actually got" screen (mockup 3b) --
// same 21 tags as EQUIPMENT_OPTIONS, just clustered for faster scanning on
// a phone instead of one flat list.
export const EQUIPMENT_GROUPS: { label: string; tags: string[] }[] = [
  { label: 'The Basics', tags: ['barbell', 'plate', 'dumbbell', 'kettlebell', 'med ball', 'sandbag', 'pvc'] },
  { label: 'Hang, Jump, Climb', tags: ['pull-up bar', 'rings', 'box', 'jump rope', 'rope', 'wall', 'band'] },
  { label: 'Machines & Benches', tags: ['bench', 'rower', 'ski erg', 'bike', 'bike erg', 'ghd', 'cable'] },
];

export type SkillCategoryKey = SkillCategory;
export type SkillLevelValue = 'rx' | 'intermediate' | 'beginner';

export const SKILL_CATEGORIES: { key: SkillCategoryKey; label: string; hint: string }[] = [
  { key: 'pull_up_bar', label: 'Pull-up bar', hint: 'Pull-ups, chest-to-bar, muscle-ups' },
  { key: 'rings', label: 'Rings', hint: 'Ring rows/dips, ring muscle-ups, toes-to-rings' },
  { key: 'handstand', label: 'Handstand', hint: 'HSPU, handstand walk, wall walks' },
  { key: 'hanging_core', label: 'Toes-to-bar / hanging core', hint: 'Toes-to-bar, knees-to-elbows' },
  { key: 'rope_climb', label: 'Rope climb', hint: '' },
  { key: 'pistol', label: 'Pistols (single-leg squat)', hint: '' },
];

export const LEVELS: { value: SkillLevelValue; label: string }[] = [
  { value: 'rx', label: 'Rx -- do it as written' },
  { value: 'intermediate', label: 'Intermediate scale' },
  { value: 'beginner', label: 'Beginner scale' },
];

// The one gating rule the mockup actually calls for (screen 3c): a skill
// category tied to an apparatus the athlete doesn't have gets greyed out
// and forced to a no-op rather than silently defaulting to Rx. Only rings
// is wired to this -- everything else in SKILL_CATEGORIES is either
// bodyweight or the design didn't call for gating it.
export const SKILL_REQUIRES_EQUIPMENT: Partial<Record<SkillCategoryKey, string>> = {
  rings: 'rings',
};
