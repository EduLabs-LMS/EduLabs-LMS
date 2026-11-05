import RouteLoadingSignal from '@/frontend/components/route-loading-signal';
import { CourseLoading } from '@/frontend/features/teacher-course/course-view';

export default function Loading() {
  return <><RouteLoadingSignal /><CourseLoading /></>;
}
