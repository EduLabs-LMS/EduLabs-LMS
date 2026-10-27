import { isFirebaseStaging } from '@/shared/auth-config';
import { TeacherFoundationPage } from '@/app/(dashboard)/_components/teacher-foundation-page';
import { TeacherCoursesPage } from '@/app/(dashboard)/_components/teacher-home-pages';
export default function Page(){return isFirebaseStaging()?<TeacherCoursesPage/>:<TeacherFoundationPage title="Courses"/>;}
