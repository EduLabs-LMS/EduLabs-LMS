import RouteLoadingSignal from '@/frontend/components/route-loading-signal';
import { TeacherCoursesLoading } from '@/frontend/features/teacher-home/courses-view';

export default function Loading() {
  return <><RouteLoadingSignal /><TeacherCoursesLoading /></>;
}
