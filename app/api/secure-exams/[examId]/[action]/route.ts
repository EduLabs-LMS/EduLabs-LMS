// The legacy secure exam runner is retired: every method answers 410 Gone (server/http/retired-route.ts).
export { retiredRoute as GET, retiredRoute as POST, retiredRoute as PUT, retiredRoute as PATCH, retiredRoute as DELETE, retiredRoute as OPTIONS, retiredRoute as HEAD } from '@/server/http/retired-route';
export const runtime = 'nodejs';
