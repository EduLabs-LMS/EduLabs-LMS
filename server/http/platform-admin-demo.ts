import 'server-only';
import { NextRequest } from 'next/server';
import { demoAction } from '@/shared/contracts/platform-demo';
import { adminAccess, failure, readJson, reply, uuid } from '@/server/http/platform-admin-portals';
import { platformDemoService } from '@/server/services/platform-demo';

/**
 * GET: the demo status of one teaching space. POST: mark, unmark, fill or clear it. The body is only a verb; the space comes from the
 * path, and the actor is the verified administrator session. No user, role or recipient can be supplied.
 */
export async function platformDemoHTTP(request: NextRequest, portalId: string) {
 try {
  const writing = request.method === 'POST';
  if (!uuid.test(portalId)) return reply({ error: 'Not found' }, 404);
  const access = await adminAccess(request, writing);
  if ('response' in access) return access.response;
  const service = platformDemoService(access.client);
  if (!writing) return reply(await service.status(portalId));
  const parsed = await readJson(request);
  if ('response' in parsed) return parsed.response;
  const input = demoAction.safeParse(parsed.body);
  if (!input.success) return reply({ error: 'Some details are not valid.', reason: 'invalid' }, 400);
  switch (input.data.action) {
   case 'mark': return reply(await service.setDemo(portalId, true));
   case 'unmark': return reply(await service.setDemo(portalId, false));
   case 'fill': return reply(await service.fill(portalId));
   case 'clear': return reply(await service.clear(portalId));
  }
 } catch (error) { return failure(error); }
}

/** Next route-handler signature for /api/platform-admin/portals/[portalId]/demo. */
export async function platformDemoRoute(request: NextRequest, context: { params: Promise<{ portalId: string }> }) {
 return platformDemoHTTP(request, (await context.params).portalId);
}
