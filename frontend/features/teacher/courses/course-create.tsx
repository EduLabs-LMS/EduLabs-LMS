'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Settings2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { useCourseManagementPath } from '@/frontend/components/providers/course-management-path';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';
import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/ui/button';
import { Input } from '@/frontend/components/ui/input';
import { Notice, Spinner } from '@/frontend/features/teacher/ui/teacher-ui';
import { api } from '@/frontend/lib/api';
import { isValidSlug, nextSlugCandidate, slugFromTitle } from '@/frontend/lib/slug';

const MAX_ATTEMPTS = 6;
const errorText = (error: unknown) => (error as { response?: { status?: number; data?: { error?: string } } }).response;

/** Guided course creation: a title is the only required step. The web address is made automatically. */
const CreateNewCoursePage = ({ organizations, existingSlugs = [] }: { organizations: { id: string; name: string }[]; existingSlugs?: string[] }) => {
	const courseBase = useCourseManagementPath();
	const { t } = useLanguage();
	const router = useRouter();
	const { startLoading, stopLoading } = useGlobalLoading();
	const [title, setTitle] = useState('');
	const [organization, setOrganization] = useState(organizations[0]?.id ?? '');
	const [customSlug, setCustomSlug] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');

	const automatic = useMemo(() => slugFromTitle(title, existingSlugs), [title, existingSlugs]);
	const slug = customSlug ?? automatic;
	const slugOk = isValidSlug(slug);
	const canCreate = title.trim().length > 0 && Boolean(organization) && slugOk && !saving;
	const reason = !title.trim() ? t('teach.create.reason_title') : !organization ? t('teach.create.reason_org') : !slugOk ? t('teach.create.reason_slug') : '';

	async function create() {
		if (!canCreate) return;
		setSaving(true);
		setError('');
		startLoading();
		let candidate = slug;
		try {
			for (let attempt = 1; ; attempt += 1) {
				try {
					const response = await api.post('/api/teacher/courses', { title: title.trim(), organization_id: organization, slug: candidate });
					toast.success(t('teach.create.created'));
					router.push(`${courseBase}/${response.data.id}`);
					return;
				} catch (e) {
					const failure = errorText(e);
					// "This slug is already in use" (409): try the next automatic name unless the teacher typed this one.
					if (failure?.status === 409 && customSlug === null && attempt < MAX_ATTEMPTS) {
						candidate = nextSlugCandidate(candidate);
						continue;
					}
					throw e;
				}
			}
		} catch (e) {
			const failure = errorText(e);
			setError(failure?.status === 409 ? t('teach.create.slug_taken') : failure?.data?.error || t('teach.create.failed'));
			setSaving(false);
		} finally {
			stopLoading();
		}
	}

	return (
		<div className="mx-auto w-full max-w-2xl space-y-4 pb-16 pt-4">
			<Link href={courseBase} className="inline-flex min-h-[44px] items-center text-sm font-semibold text-slate-800 hover:text-black">
				<ArrowLeft className="me-1.5 h-4 w-4 rtl:rotate-180" aria-hidden />
				{t('teach.back_to_courses')}
			</Link>
			<form
				className="space-y-6 rounded-3xl border-2 border-black bg-white p-6 shadow-hard-sm sm:p-8"
				onSubmit={(event) => {
					event.preventDefault();
					void create();
				}}
			>
				<div className="space-y-1">
					<span className="text-xs font-bold uppercase tracking-wider text-emerald-900">{t('teach.create.pill')}</span>
					<h1 className="font-display text-3xl sm:text-4xl">{t('teach.create.title')}</h1>
					<p className="text-sm text-slate-700">{t('teach.create.subtitle')}</p>
				</div>

				<label className="block text-sm font-semibold text-slate-900">
					{t('teach.create.name_label')} <span className="font-bold text-red-700" aria-hidden>*</span>
					<span className="sr-only"> (required)</span>
					<Input dir="auto" autoFocus required maxLength={200} value={title} disabled={saving} placeholder={t('teach.create.name_placeholder')} className="mt-1.5 min-h-[52px] text-base" onChange={(event) => setTitle(event.target.value)} />
					<span className="mt-1 block text-xs font-normal text-slate-700">{t('teach.create.name_help')}</span>
				</label>

				{organizations.length > 1 && (
					<label className="block text-sm font-semibold text-slate-900">
						{t('teach.create.organization')}
						<select aria-label={t('teach.create.organization')} required disabled={saving} value={organization} onChange={(event) => setOrganization(event.target.value)} className="mt-1.5 block min-h-[48px] w-full rounded-xl border-2 border-black bg-white px-3 text-sm font-medium">
							{organizations.map((o) => (
								<option key={o.id} value={o.id}>
									{o.name}
								</option>
							))}
						</select>
					</label>
				)}

				<details className="rounded-2xl border border-slate-300 bg-slate-50 p-4">
					<summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-semibold text-slate-900">
						<Settings2 className="h-4 w-4" aria-hidden />
						{t('teach.create.advanced')}
					</summary>
					<div className="mt-3 space-y-2">
						<label className="block text-sm font-medium">
							{t('teach.create.slug')}
							<Input aria-label={t('teach.create.slug')} dir="ltr" required maxLength={100} pattern="[a-z0-9]+(-[a-z0-9]+)*" value={slug} disabled={saving} aria-invalid={!slugOk} className="mt-1 min-h-[44px]" onChange={(event) => setCustomSlug(event.target.value.toLowerCase())} />
						</label>
						<p className="text-xs text-slate-700">{t('teach.create.slug_help')}</p>
						{customSlug !== null && (
							<Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => setCustomSlug(null)}>
								{t('teach.create.slug_auto')}
							</Button>
						)}
					</div>
				</details>

				{error && <Notice tone="danger">{error}</Notice>}
				<p className="min-h-[1.25rem] text-xs font-medium text-slate-800" aria-live="polite">
					{reason}
				</p>

				<div className="flex flex-col-reverse gap-2 border-t border-slate-300 pt-4 sm:flex-row sm:justify-end">
					<Button asChild type="button" variant="outline" className="min-h-[48px]">
						<Link href={courseBase}>{t('teach.cancel')}</Link>
					</Button>
					<Button type="submit" className="min-h-[48px] px-8" disabled={!canCreate}>
						{saving ? <Spinner label={t('teach.saving')} /> : t('teach.create.continue')}
					</Button>
				</div>
			</form>
		</div>
	);
};

export default CreateNewCoursePage;
