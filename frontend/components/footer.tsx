'use client';

import { isFirebaseStaging } from '@/shared/auth-config';
import { Brand } from '@/frontend/design/tree';
import { useLocale } from '@/frontend/design/preferences';
import { useSupportModal } from '@/frontend/hooks/use-support-modal';
import { HelpCircle, MessageCircle, Phone } from 'lucide-react';
import { TEACHER_CONTACT } from '@/shared/constants/contact';

const Footer = () => {
	const { onOpen } = useSupportModal();
  const {t}=useLocale();
  if (isFirebaseStaging()) return <footer className="edu-footer"><Brand/><nav aria-label={t('Contact and website help')}><a className="edu-link" href={TEACHER_CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer">{t('WhatsApp Mrs. Ghada')}</a><a className="edu-link" href={TEACHER_CONTACT.phoneUrl}>{t('Call Mrs. Ghada')}</a><button type="button" onClick={onOpen} className="edu-link">{t('Website Help')}</button></nav><small>{t('Made by')}: Mohamed Ahmed Yehia &amp; Mohamed Tamer Mohamed</small></footer>;
	const contactClass = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2';

	return (
		<footer className="border-t border-slate-200 bg-white px-4 py-6 sm:px-6">
			<div className="mx-auto max-w-7xl">
				<div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
					<div className="space-y-1">
						<p className="text-sm font-semibold text-slate-900">The Life of Physics</p>
						<p className="text-xs leading-relaxed text-slate-500">
							Lesson questions? Contact {TEACHER_CONTACT.name} · {TEACHER_CONTACT.displayPhone}
						</p>
					</div>
					<nav aria-label="Contact and website help" className="flex flex-wrap items-center gap-2">
						<a href={TEACHER_CONTACT.whatsappUrl} target="_blank" rel="noopener noreferrer" className={`${contactClass} bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
							<MessageCircle className="h-4 w-4" aria-hidden="true" />
							WhatsApp Mrs. Ghada
						</a>
						<a href={TEACHER_CONTACT.phoneUrl} className={`${contactClass} border border-slate-200 text-slate-700 hover:bg-slate-50`}>
							<Phone className="h-4 w-4" aria-hidden="true" />
							Call Mrs. Ghada
						</a>
						<button type="button" onClick={onOpen} className={`${contactClass} text-sky-700 hover:bg-sky-50`}>
							<HelpCircle className="h-4 w-4" aria-hidden="true" />
							Website Help
						</button>
					</nav>
				</div>
				<p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-relaxed text-slate-500">
					Made by: <span className="font-medium text-slate-700">Mohamed Ahmed Yehia</span> &amp; <span className="font-medium text-slate-700">Mohamed Tamer Mohamed</span>
				</p>
			</div>
		</footer>
	);
};

export default Footer;
