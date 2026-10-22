import { requireStudentPreview } from '@/server/services/student-preview';
import { PreviewBar } from '@/frontend/features/preview/preview-bar';
import { PreviewGuard } from '@/frontend/features/preview/preview-guard';

/** Look-only student preview for teacher-side roles. Students and platform roles get a 404. */
export default async function PreviewLayout({ children }: { children: React.ReactNode }) {
  await requireStudentPreview();
  return <div><PreviewGuard /><PreviewBar />{children}</div>;
}
