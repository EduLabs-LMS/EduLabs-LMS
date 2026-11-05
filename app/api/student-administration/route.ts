import { studentAdministrationPOST } from '@/server/http/student-administration';
import { withServerTiming } from '@/server/http/server-timing';
export const POST = withServerTiming(studentAdministrationPOST);
