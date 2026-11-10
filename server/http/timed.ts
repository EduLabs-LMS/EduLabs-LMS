import 'server-only';
import { withServerTiming } from './server-timing';
import { communicationsPOST } from './communications';
import { studentAdministrationPOST } from './student-administration';
import { groupCourseRunPOST } from './group-course-run';
import { groupsPOST } from './groups';
import { academicsHTTP } from './academics';
import { createCoursePOST } from './teacher-course';
import { updateCoursePATCH } from './teacher-course';
import { courseContentGET, courseContentPOST } from './course-content';
import { homeworkDeleteImagesPOST, homeworkGET, homeworkLifecyclePOST, homeworkPortalGET, homeworkSavePOST } from './teacher-homework';

/** Every API route's handler with the optional Server-Timing header (LMS_SERVER_TIMING=1, staging only). The route files stay one-line adapters. */
export const timedCommunicationsPOST = withServerTiming(communicationsPOST);
export const timedStudentAdministrationPOST = withServerTiming(studentAdministrationPOST);
export const timedGroupCourseRunPOST = withServerTiming(groupCourseRunPOST);
export const timedGroupsPOST = withServerTiming(groupsPOST);
export const timedAcademicsHTTP = withServerTiming(academicsHTTP);
export const timedCreateCoursePOST = withServerTiming(createCoursePOST);
export const timedUpdateCoursePATCH = withServerTiming(updateCoursePATCH);
export const timedCourseContentGET = withServerTiming(courseContentGET);
export const timedCourseContentPOST = withServerTiming(courseContentPOST);
export const timedHomeworkPortalGET = withServerTiming(homeworkPortalGET);
export const timedHomeworkGET = withServerTiming(homeworkGET);
export const timedHomeworkSavePOST = withServerTiming(homeworkSavePOST);
export const timedHomeworkLifecyclePOST = withServerTiming(homeworkLifecyclePOST);
export const timedHomeworkDeleteImagesPOST = withServerTiming(homeworkDeleteImagesPOST);
