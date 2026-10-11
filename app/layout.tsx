import { ApplicationAuthProvider } from '@/frontend/components/providers/application-auth-provider';
import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import './globals.css';
import type { Metadata } from 'next';
import { Caprasimo, Figtree, Lalezar, Cairo } from 'next/font/google';
import { cookies } from 'next/headers';
import { Preferences } from '@/frontend/design/preferences';
import '@/frontend/styles/marketing.css';
import '@/frontend/styles/edulabs.css';
import { ToastProvider } from '@/frontend/components/providers/toast-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import FacebookMessenger from '@/frontend/components/facebook-messenger';
import { isTeacher } from '@/server/services/teacher';
import { LoadingProvider } from '@/frontend/components/providers/loading-provider';
import ScrollToTop from '@/frontend/components/scroll-to-top';
import { isFirebaseStaging } from '@/shared/auth-config';
import { FirebaseAuthProvider } from '@/frontend/components/providers/firebase-auth-provider';

const caprasimo = Caprasimo({ subsets: ['latin'], weight: '400', variable: '--font-caprasimo', display: 'swap' });
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', display: 'swap' });
const lalezar = Lalezar({ subsets: ['arabic'], weight: '400', variable: '--font-lalezar', display: 'swap' });
const cairo = Cairo({ subsets: ['arabic'], variable: '--font-cairo', display: 'swap' });
// Both backends render request-specific authentication; never prerender accounts.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'EduLabs | Your learning, all in one place',
	description: 'EduLabs brings your courses, teaching and learning together in one secure space.',
};

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const firebase = isFirebaseStaging();
	const locale = (await cookies()).get('edulabs-locale')?.value === 'ar' ? 'ar' : 'en';
	const session = firebase ? null : await auth();
	const isStaff = session ? await isTeacher(session.userId, session.sessionClaims) : false;
	const AuthProvider = firebase ? FirebaseAuthProvider : ClerkProvider;

	return (
		<AuthProvider {...(firebase ? {} : { afterSignOutUrl: '/', appearance: { options: { showOptionalFields: true } } })}>
			<html lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'} data-edulabs="" className={`${caprasimo.variable} ${figtree.variable} ${lalezar.variable} ${cairo.variable}`} suppressHydrationWarning>
				<body>
					<ThemeProvider
						attribute="class"
						defaultTheme="light"
						forcedTheme={firebase ? undefined : "light"}
						enableSystem={false}
						disableTransitionOnChange
					>
						<Preferences initialLocale={locale}><ApplicationAuthProvider><LoadingProvider>
							<ScrollToTop />

							<ToastProvider />

							{children}

							{!firebase && !isStaff && <FacebookMessenger />}
						</LoadingProvider></ApplicationAuthProvider></Preferences>
					</ThemeProvider>
				</body>
			</html>
		</AuthProvider>
	);
}
