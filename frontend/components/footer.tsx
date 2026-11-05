'use client';

import { L, Localized } from '@/frontend/components/language-provider';
import { isFirebaseStaging } from '@/shared/auth-config';
import { HelpCircle, MessageCircle, Phone } from 'lucide-react';
import { TEACHER_CONTACT } from '@/shared/constants/contact';

/** The credits, in the owner's order and colours (DECISIONS.md). One left-to-right run, so the order of the names holds in Arabic too. */
export const FooterCredits = () => <><L id="common.made_by"/>{" "}<bdi dir="ltr" data-credits><span data-credit="1" className="d-credit-1 font-medium">Mohamed Tamer Mohamed</span> &amp; <span data-credit="2" className="d-credit-2 font-medium">Mohamed Ahmed Yehia</span></bdi></>;

/** `audience="teacher"` is the teacher frame: teachers get EduLabs' help line, because "your authorized teacher" is written for students. */
const Footer = ({ audience = 'student' }: { audience?: 'student' | 'teacher' }) => {
	const firebase = isFirebaseStaging();
	const contactClass = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border-2 border-black px-3.5 py-2 text-sm font-semibold shadow-hard-sm transition-all hover:-translate-y-px hover:shadow-hard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2';

	return (
		<footer className="border-t-[2.5px] border-black bg-white px-4 py-6 sm:px-6">
			<div className="mx-auto max-w-7xl">
				<div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
					<div className="space-y-1">
						<p className="font-display text-xl text-slate-900">EduLabs</p>
						<p data-footer-help className="text-xs leading-relaxed text-slate-500">
							{audience === 'teacher' ? <><L id="footer.teacher_help"/>{" "}<a href="/support" data-footer-support className="d-focus font-semibold underline underline-offset-2"><L id="footer.teacher_help_link"/></a></> : firebase ? <L id="dynamic.platformHelp"/> : <><L id="common.lesson_questions_contact"/>{" "}{TEACHER_CONTACT.name} · {TEACHER_CONTACT.displayPhone}</>}
						</p>
					</div>
					<Localized as="nav" labels={{"aria-label":"common.contact_and_support"}} className="flex flex-wrap items-center gap-2">
						<a role="link" href={firebase ? undefined : TEACHER_CONTACT.whatsappUrl} aria-disabled={firebase || undefined} tabIndex={0} title={firebase ? 'Course help routing is not yet available.' : undefined} target={firebase ? undefined : '_blank'} rel="noopener noreferrer" className={`${contactClass} bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
							<MessageCircle className="h-4 w-4" aria-hidden="true" />
							{firebase ? <L id="dynamic.courseHelp"/> : <L id="dynamic.whatsapp"/>}
						</a>
						<a role="link" href={firebase ? undefined : TEACHER_CONTACT.phoneUrl} aria-disabled={firebase || undefined} tabIndex={0} title={firebase ? 'Course contact routing is not yet available.' : undefined} className={`${contactClass} bg-white text-slate-700 hover:bg-slate-100`}>
							<Phone className="h-4 w-4" aria-hidden="true" />
							{firebase ? <L id="dynamic.contactSoon"/> : <L id="dynamic.call"/>}
						</a>
						<a role="link" href="/support" tabIndex={0} className={`${contactClass} text-sky-700 hover:bg-sky-50`}>
							<HelpCircle className="h-4 w-4" aria-hidden="true" /><L id="navigation.support"/></a>
					</Localized>
				</div>
				<p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500"><FooterCredits />
				</p>
			</div>
		</footer>
	);
};

export default Footer;
