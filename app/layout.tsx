import { cookies } from 'next/headers';
import { LanguageProvider } from '@/frontend/components/language-provider';
import { isLanguage, languageCookieKey, languageDirection } from '@/shared/language';
import { designCookieKey, designFromCookie } from '@/shared/design';
import { ApplicationAuthProvider } from '@/frontend/components/providers/application-auth-provider';
import { ClerkProvider } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import './globals.css';
import '@/frontend/styles/appearance.css';
import '@/frontend/styles/language.css';
import '@/frontend/styles/design-tokens.css';
import '@/frontend/styles/design-components.css';
import '@/frontend/styles/design-bridge.css';
import type { Metadata } from 'next';
import { Figtree, Caprasimo, Cairo, Lalezar } from 'next/font/google';
import { ToastProvider } from '@/frontend/components/providers/toast-provider';
import { ThemeProvider } from '@/frontend/components/theme-provider';
import FacebookMessenger from '@/frontend/components/facebook-messenger';
import { isTeacher } from '@/server/services/teacher';
import { LoadingProvider } from '@/frontend/components/providers/loading-provider';
import FirstOpenCurtain from '@/frontend/components/first-open-curtain';
import { firstOpenScript } from '@/frontend/lib/first-load';
import ScrollToTop from '@/frontend/components/scroll-to-top';
import { isFirebaseStaging } from '@/shared/auth-config';
import { FirebaseAuthProvider } from '@/frontend/components/providers/firebase-auth-provider';

const figtree = Figtree({ subsets: ['latin'], variable: '--font-body', display: 'swap' });
const caprasimo = Caprasimo({ subsets: ['latin'], weight: '400', variable: '--font-display', display: 'swap' });
const cairo = Cairo({ subsets: ['arabic', 'latin'], variable: '--font-arabic-body', display: 'swap', preload: false });
const lalezar = Lalezar({ subsets: ['arabic', 'latin'], weight: '400', variable: '--font-arabic-display', display: 'swap', preload: false });
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
	const cookieStore = await cookies();
	const savedLanguage = cookieStore.get(languageCookieKey)?.value;
	// Set by the server, so the page never flashes the other look. An unknown value is the default.
	const design = designFromCookie(cookieStore.get(designCookieKey)?.value);
 const language = isLanguage(savedLanguage) ? savedLanguage : 'en';
 const firebase = isFirebaseStaging();
	const session = firebase ? null : await auth();
	const isStaff = session ? await isTeacher(session.userId, session.sessionClaims) : false;
	const AuthProvider = firebase ? FirebaseAuthProvider : ClerkProvider;

	return (
		<AuthProvider {...(firebase ? {} : { afterSignOutUrl: '/', appearance: { options: { showOptionalFields: true } } })}>
			<html lang={language} dir={languageDirection(language)} data-lms-appearance data-design={design} suppressHydrationWarning>
				<head>
					{/* Before anything paints: is this a fresh opening of the site in this tab? See frontend/lib/first-load.ts. A constant string: nothing from the request goes in it. */}
					<script dangerouslySetInnerHTML={{ __html: firstOpenScript }} />
				</head>
				<body className={`${figtree.variable} ${caprasimo.variable} ${cairo.variable} ${lalezar.variable} font-sans`}>
					<LanguageProvider initialLanguage={language}><ThemeProvider
						attribute="class"
						defaultTheme="light"
						enableSystem
						disableTransitionOnChange
					>
						<ApplicationAuthProvider><LoadingProvider>
							<ScrollToTop />

							<ToastProvider />

							{children}

							{!firebase && !isStaff && <FacebookMessenger />}
						</LoadingProvider></ApplicationAuthProvider>
					</ThemeProvider></LanguageProvider>
					<FirstOpenCurtain />
				</body>
			</html>
		</AuthProvider>
	);
}
