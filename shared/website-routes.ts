/** Only pages with an explicit Firebase/Supabase adapter may reach the original routes. */
export function isPhaseOneRoute(path: string) {
  return ['/', '/home', '/dashboard', '/self-learning', '/search', '/group', '/groups', '/sessions-groups', '/sessions', '/teacher/courses', '/teacher/create', '/onboarding/organization', '/exams', '/unavailable','/admin/submissions','/admin/users','/access','/support','/notifications'].includes(path) || /^\/join\/[A-Za-z0-9_-]{43}$/.test(path) ||
    /^\/teacher\/courses\/[0-9a-f-]{36}(?:\/chapters\/[0-9a-f-]{36})?$/.test(path) || /^\/courses\/[0-9a-f-]{36}\/chapters\/[0-9a-f-]{36}$/.test(path) || /^\/courses\/[^/]+(?:\/detail)?$/.test(path) || /^\/offerings\/[^/]+$/.test(path) ||
    /^\/exams\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path);
}
