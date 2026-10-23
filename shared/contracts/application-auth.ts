export interface ApplicationViewer {
  id: string;
  displayName: string;
  email: string;
  backend: 'clerk' | 'firebase';
}

export interface WebsiteNavigation {
  viewer: ApplicationViewer;
  organizations: { id: string; name: string }[];
  staffOrganizationIds: string[];
  /** Display-only: true for teacher-side users (same condition as the teacher route guard). */
  teacherSide?: boolean;
  /** Display-only student preview; never changes the real role or permissions. */
  studentPreview?: boolean;
}
