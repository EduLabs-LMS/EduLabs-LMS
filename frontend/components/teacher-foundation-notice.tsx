import { L } from '@/frontend/components/language-provider';
/** Neutral replacement, not the old management UI or an authorization boundary. */
export function TeacherFoundationNotice({ title = 'Teacher workspace' }: { title?: string }) {
 return <section data-teacher-foundation className="mx-auto max-w-5xl rounded-2xl border border-border bg-card p-6 space-y-3">
  <h1 className="font-display text-2xl"><bdi>{title}</bdi></h1>
  <p role="status"><L id="foundation.teacher_rebuild"/></p>
  <p className="text-sm text-muted-foreground"><L id="foundation.data_preserved"/></p>
 </section>;
}
