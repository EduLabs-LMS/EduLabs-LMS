import { updateCoursePATCH } from '@/server/http/teacher-course';
import { withServerTiming } from '@/server/http/server-timing';
export const PATCH = withServerTiming(updateCoursePATCH);
