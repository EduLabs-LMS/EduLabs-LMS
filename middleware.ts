import { publicWebsiteRoute } from '@/shared/public-website';
import { isPhaseOneRoute } from '@/shared/website-routes';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { isFirebaseStaging } from '@/shared/auth-config';

const isPublicRoute = createRouteMatcher([
	'/sign-in(.*)',
	'/sign-up(.*)',
	'/api/uploadthing',
	'/test-page',
]);

const legacyMiddleware = clerkMiddleware(async (auth, request) => {
	if (!isPublicRoute(request)) await auth.protect();
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const path = request.nextUrl.pathname;
  if (path === '/t' || path.startsWith('/t/')) {
    const route=publicWebsiteRoute(path);
    if(!route || !isFirebaseStaging())return new NextResponse('Not found',{status:404,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
    return NextResponse.next();
  }
  if (path === '/teacher/website') {const response=NextResponse.next();response.headers.set('X-Robots-Tag','noindex, nofollow');if(isFirebaseStaging())return response;}
  if (path === '/api/health') return NextResponse.next();
  if (path.startsWith('/api/auth/firebase/')) return NextResponse.next();
  if (!isFirebaseStaging()) {
    if (path === '/lms-staging') return NextResponse.redirect(new URL('/sign-in', request.url));
    return legacyMiddleware(request, event);
  }
  // Platform administration: handlers authorize in PostgreSQL; this only lets the paths reach them.
  if (path === '/platform-admin' || path.startsWith('/platform-admin/')) {const response=NextResponse.next();response.headers.set('X-Robots-Tag','noindex, nofollow');response.headers.set('Cache-Control','private, no-store');return response;}
  if (path === '/api/platform-admin/portals' || /^\/api\/platform-admin\/portals\/[0-9a-f-]{36}(?:\/demo)?$/.test(path) || path === '/api/teacher-invitations/accept' || path === '/api/teacher-invitations/preview') return NextResponse.next();
  // The invitation page: its link carries the secret in the URL fragment (never sent to a server); keep it out of caches, indexes and referrers.
  if (path === '/teacher-invitation') {const response=NextResponse.next();response.headers.set('Referrer-Policy','no-referrer');response.headers.set('Cache-Control','private, no-store');response.headers.set('X-Robots-Tag','noindex, nofollow');return response;}
  // Teacher Settings and Groups & Classes: EXACT pages only, nothing underneath them (scripts/teacher-settings-groups.test.cjs runs this function and keeps the list in step with shared/teacher-settings.ts).
  if (path === '/teacher/settings' || path === '/teacher/settings/account' || path === '/teacher/settings/courses' || path === '/teacher/settings/language' || path === '/teacher/settings/notifications') return NextResponse.next();
  if (path === '/teacher/groups' || /^\/teacher\/groups\/[0-9a-f-]{36}(\/attendance\/[0-9a-f-]{36})?$/.test(path)) return NextResponse.next();
  if (path === '/api/personalization') return NextResponse.next();
  if (path === '/api/student-academics') return NextResponse.next();
  if (path === '/api/learning-overview') return NextResponse.next();
  if (/^\/api\/teacher\/(website|academics|organizations|courses(?:\/[0-9a-f-]{36})?)$/.test(path)) return NextResponse.next();
  if (/^\/api\/homework\/(new|[0-9a-f-]{36})\/(list|offerings|save|get|lifecycle|copy-media|assignments|revisions|inbox|history|work|upload-intent|finish-upload|cleanup|media)$/.test(path)) return NextResponse.next();
  if (/^\/api\/learning\/[0-9a-f-]{36}\/(edit|progress|upload|media|cleanup|upload-intent|finish-upload)$/.test(path)) return NextResponse.next();
  if (/^\/api\/learning\/[0-9a-f-]{36}\/(resources|blocks)\/[0-9a-f-]{36}$/.test(path)) return NextResponse.next();
  if (/^\/api\/secure-exams\/[0-9a-f-]{36}\/(state|start|answers|submit|decision|result|photo|grading|grade|release|release-review|definition|save-definition|clone)$/.test(path)) return NextResponse.next();
  if (/^\/join\/[A-Za-z0-9_-]{43}$/.test(path)) {const response=NextResponse.next();response.headers.set('Referrer-Policy','no-referrer');response.headers.set('Cache-Control','private, no-store');return response;}
  if (path === '/api/student-administration' || path === '/api/communications' || path === '/api/study-groups' || path.startsWith('/sign-in') || path.startsWith('/sign-up') || path === '/lms-staging' || isPhaseOneRoute(path)) return NextResponse.next();
  // No Firebase UID may enter an unmigrated Clerk/Prisma or UploadThing handler.
  if (path.startsWith('/api/') || path.startsWith('/trpc/')) return NextResponse.json({ error: 'This legacy workflow is unavailable in Firebase staging.' }, { status: 503 });
  return NextResponse.redirect(new URL('/unavailable', request.url));
}

export const config = {
	matcher: ['/t/:path*', '/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
