import { createCoursePOST } from '@/server/http/teacher-course';
import { withServerTiming } from '@/server/http/server-timing';
export const POST = withServerTiming(createCoursePOST);
