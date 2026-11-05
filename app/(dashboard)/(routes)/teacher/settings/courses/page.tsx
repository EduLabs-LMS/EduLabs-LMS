import { redirect } from 'next/navigation';

/** The old address of the course list. One course's page stays at /teacher/settings/courses/<id>. */
export default function Page() {
  redirect('/teacher/courses');
}
