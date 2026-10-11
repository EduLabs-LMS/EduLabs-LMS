import { isPhaseOneRoute } from '@/shared/website-routes';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest, type NextFetchEvent } from 'next/server';
import { isFirebaseStaging } from '@/shared/auth-config';

const isPublicRoute = createRouteMatcher([
	'/sign-in(.*)',
	'/sign-up(.*)',
	'/api/uploadthing',
	'/test-page',
	'/design-preview',
]);

const legacyMiddleware = clerkMiddleware(async (auth, request) => {
	if (!isPublicRoute(request)) await auth.protect();
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  const path = request.nextUrl.pathname;
  if (path.startsWith('/api/auth/firebase/')) return NextResponse.next();
  if (!isFirebaseStaging()) {
    if (path === '/lms-staging') return NextResponse.redirect(new URL('/sign-in', request.url));
    return legacyMiddleware(request, event);
  }
  // Keep Clerk request context in fallback mode; this preview has no tenant data.
  if (path === '/design-preview') return NextResponse.next();
  if (/^\/api\/teacher\/(organizations|courses(?:\/[0-9a-f-]{36})?)$/.test(path)) return NextResponse.next();
  if (path.startsWith('/sign-in') || path.startsWith('/sign-up') || path === '/lms-staging' || isPhaseOneRoute(path)) return NextResponse.next();
  // No Firebase UID may enter an unmigrated Clerk/Prisma or UploadThing handler.
  if (path.startsWith('/api/') || path.startsWith('/trpc/')) return NextResponse.json({ error: 'This legacy workflow is unavailable in Firebase staging.' }, { status: 503 });
  return NextResponse.redirect(new URL('/unavailable', request.url));
}

export const config = {
	matcher: ['/((?!.+\\.[\\w]+$|_next).*)', '/', '/(api|trpc)(.*)'],
};
