import Link from 'next/link';
import { Eye, LogOut } from 'lucide-react';
import { L } from '@/frontend/components/language-provider';
import { COURSE_MANAGEMENT_PATH } from '@/shared/course-management-path';

/** Persistent "this is a preview" bar with a one-tap exit. Logical (start/end) spacing keeps it correct in RTL. */
export function PreviewBar() {
  return <div role="status" data-student-preview-bar className="sticky top-2 z-40 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-black bg-primary px-4 py-3 text-black shadow-hard-sm">
    <div className="flex min-w-0 items-center gap-3">
      <Eye aria-hidden className="h-5 w-5 shrink-0" />
      <div className="min-w-0"><p className="text-sm font-bold leading-tight"><L id="preview.banner_title" /></p><p className="text-xs leading-snug sm:text-sm"><L id="preview.banner_text" /></p></div>
    </div>
    <Link href={COURSE_MANAGEMENT_PATH} className="inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border-2 border-black bg-white px-4 text-sm font-bold text-black active:translate-x-0.5 active:translate-y-0.5">
      <LogOut aria-hidden className="h-4 w-4 rtl:rotate-180" /><L id="navigation.back_to_teacher_view" />
    </Link>
  </div>;
}
