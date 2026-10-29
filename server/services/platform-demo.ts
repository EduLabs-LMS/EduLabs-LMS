import 'server-only';
import type { getSupabaseServerClient } from '@/server/integrations/supabase';
import { provisioningFailure } from '@/server/services/platform-provisioning';
import { latestDemoSeedVersion, type DemoClearResult, type DemoFillResult, type DemoMarkResult, type DemoStatus } from '@/shared/contracts/platform-demo';

type Client = Awaited<ReturnType<typeof getSupabaseServerClient>>;
type DbError = { code?: string; message?: string };

/** The database raises one code (PT409) for several distinct refusals; its message tells them apart. Nothing else is trusted from the text. */
export function demoError(error: DbError) {
 const text = error.message ?? '';
 switch (error.code) {
  case '42501': return provisioningFailure('This action is not permitted.', 403, 'forbidden');
  case 'PT404': return provisioningFailure('That teaching space was not found.', 404, 'not_found');
  case 'PT409':
   if (/not marked as a demo/i.test(text)) return provisioningFailure('This space is not a demo space.', 409, 'demo_not_marked');
   if (/already present/i.test(text)) return provisioningFailure('Demo data is already present.', 409, 'demo_filled');
   if (/not accepted the invitation/i.test(text)) return provisioningFailure('The teacher has not accepted the invitation yet.', 409, 'not_accepted');
   if (/enrolled students/i.test(text)) return provisioningFailure('A space with enrolled students cannot be a demo space.', 409, 'has_students');
   if (/Clear the demo data/i.test(text)) return provisioningFailure('Clear the demo data first.', 409, 'demo_not_cleared');
   return provisioningFailure('The action conflicts with the current state.', 409, 'conflict');
  case '22023': return provisioningFailure('Some details are not valid.', 400, 'invalid');
  default: return provisioningFailure('Demo space management is unavailable. Please retry.', 503, 'unavailable');
 }
}

const count = (value: unknown) => (Number.isInteger(value) && (value as number) >= 0 ? (value as number) : null);
const unavailable = () => provisioningFailure('Demo space management is unavailable. Please retry.', 503, 'unavailable');

/** The caller must already have passed getPlatformAdminAccess(); every RPC re-checks in the database and audits the change. */
export function platformDemoService(client: Client) {
 return {
  async status(organizationId: string): Promise<DemoStatus> {
   const { data, error } = await client.rpc('platform_demo_status', { p_org: organizationId });
   if (error) throw demoError(error);
   const row = data as Record<string, unknown> | null;
   if (!row || typeof row.demo !== 'boolean' || typeof row.filled !== 'boolean') throw unavailable();
   return { demo: row.demo, filled: row.filled, seedVersion: count(row.seedVersion), filledAt: typeof row.filledAt === 'string' ? row.filledAt : null, latestSeedVersion: count(row.latestSeedVersion) ?? latestDemoSeedVersion };
  },
  /** Marks (on) or unmarks (off). Unmarking is refused by the database while demo data is still present. */
  async setDemo(organizationId: string, on: boolean): Promise<DemoMarkResult> {
   const { data, error } = await client.rpc('platform_set_demo_space', { p_org: organizationId, p_on: on });
   if (error) throw demoError(error);
   const row = data as Record<string, unknown> | null;
   if (!row || row.demo !== on) throw unavailable();
   return { organizationId, demo: on };
  },
  async fill(organizationId: string): Promise<DemoFillResult> {
   const { data, error } = await client.rpc('platform_demo_fill', { p_org: organizationId });
   if (error) throw demoError(error);
   const row = data as Record<string, unknown> | null;
   const [seedVersion, courses, lessons, groups, sessions, students] = ['seedVersion', 'courses', 'lessons', 'groups', 'sessions', 'students'].map((k) => count(row?.[k]));
   if (seedVersion === null || courses === null || lessons === null || groups === null || sessions === null || students === null) throw unavailable();
   return { seedVersion, courses, lessons, groups, sessions, students };
  },
  async clear(organizationId: string): Promise<DemoClearResult> {
   const { data, error } = await client.rpc('platform_demo_clear', { p_org: organizationId });
   if (error) throw demoError(error);
   const removedRows = count((data as Record<string, unknown> | null)?.removedRows);
   if (removedRows === null) throw unavailable();
   return { removedRows };
  },
 };
}
