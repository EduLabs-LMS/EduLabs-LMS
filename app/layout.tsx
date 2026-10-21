import { ApplicationAuthProvider } from '@/frontend/components/providers/application-auth-provider';
import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import './globals.css';
import '@/frontend/styles/appearance.css';
import type { Metadata } from 'next';
import { Figtree, Caprasimo } from 'next/font/google';
import { ToastProvider } from '@/frontend/components/providers/toast-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import FacebookMessenger from '@/frontend/components/facebook-messenger';
import { isTeacher } from '@/server/services/teacher';
import { LoadingProvider } from '@/frontend/components/providers/loading-provider';
import IntroSplash from '@/frontend/components/intro-splash';
import ScrollToTop from '@/frontend/components/scroll-to-top';
import { isFirebaseStaging } from '@/shared/auth-config';
import { FirebaseAuthProvider } from '@/frontend/components/providers/firebase-auth-provider';

const figtree = Figtree({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const caprasimo = Caprasimo({ subsets: ['latin'], weight: '400', variable: '--font-display', display: 'swap' });
// Both backends render request-specific authentication; never prerender accounts.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
	title: 'EduLabs | Learning Platform',
	description: 'EduLabs: a modern learning platform template.',
};

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const firebase = isFirebaseStaging();
	const session = firebase ? null : await auth();
	const isStaff = session ? await isTeacher(session.userId, session.sessionClaims) : false;
	const AuthProvider = firebase ? FirebaseAuthProvider : ClerkProvider;

	return (
		<AuthProvider {...(firebase ? {} : { afterSignOutUrl: '/', appearance: { options: { showOptionalFields: true } } })}>
			<html lang="en" data-lms-appearance suppressHydrationWarning>
				<body className={`${figtree.variable} ${caprasimo.variable} font-sans`}>
					<ThemeProvider
						attribute="class"
						defaultTheme="light"
						enableSystem
						disableTransitionOnChange
					>
						<ApplicationAuthProvider><LoadingProvider><IntroSplash />
							<ScrollToTop />

							<ToastProvider />

							{children}

							{!firebase && !isStaff && <FacebookMessenger />}
						</LoadingProvider></ApplicationAuthProvider>
					</ThemeProvider>
				</body>
			</html>
		</AuthProvider>
	);
}
