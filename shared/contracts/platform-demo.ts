import { z } from 'zod';

/**
 * Mirrors private.platform_set_demo_space / platform_demo_fill / platform_demo_clear / platform_demo_status.
 * The seed version below must equal the latest `latestSeedVersion` in supabase/migrations and the newest row of
 * docs/ai/DEMO_DATA.md (scripts/demo-spaces.test.cjs fails when the three disagree).
 */
export const latestDemoSeedVersion = 2;

/** The only body an administrator can send: a verb. The organization comes from the path; no user, role or recipient is ever accepted. */
export const demoAction = z.object({ action: z.enum(['mark', 'unmark', 'fill', 'clear']) }).strict();
export type DemoAction = z.infer<typeof demoAction>['action'];

export type DemoStatus = { demo: boolean; filled: boolean; seedVersion: number | null; filledAt: string | null; latestSeedVersion: number };
export type DemoMarkResult = { organizationId: string; demo: boolean };
export type DemoFillResult = { seedVersion: number; courses: number; lessons: number; groups: number; sessions: number; students: number };
export type DemoClearResult = { removedRows: number };
