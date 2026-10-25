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
}


/** Exact same-origin routes that may be used as Firebase sign-in continuations. */
export function safeApplicationAuthDestination(value: string | null) {
  return value === '/home' || value === '/access' || value === '/accept-teacher-invitation' ||
    /^\/join\/[A-Za-z0-9_-]{43}$/.test(value ?? '') ? value! : '/home';
}
