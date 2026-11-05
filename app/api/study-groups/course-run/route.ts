import { groupCourseRunPOST } from '@/server/http/group-course-run';
import { withServerTiming } from '@/server/http/server-timing';
export const POST = withServerTiming(groupCourseRunPOST);
