'use client';
import { createContext, useContext } from 'react';
import { COURSE_MANAGEMENT_PATH, TEACHER_COURSES_PATH } from '@/shared/course-management-path';

const PathContext = createContext<string>(TEACHER_COURSES_PATH);

export function CourseManagementPathProvider({ teacherSide, children }: { teacherSide: boolean; children: React.ReactNode }) {
  return <PathContext.Provider value={teacherSide ? COURSE_MANAGEMENT_PATH : TEACHER_COURSES_PATH}>{children}</PathContext.Provider>;
}
/** Base path of the course management area for the current viewer (no trailing slash). */
export const useCourseManagementPath = () => useContext(PathContext);
export const useIsTeacherSide = () => useContext(PathContext) === COURSE_MANAGEMENT_PATH;
