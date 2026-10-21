'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { type ThemeProviderProps } from 'next-themes/dist/types';
import { appearanceBootstrap, appearanceStorageKey, isAppearanceMode } from '@/shared/appearance';

function AppearanceGuard() {
 const { theme, setTheme } = useTheme();
 React.useEffect(() => {
  if (theme && !isAppearanceMode(theme)) setTheme('light');
 }, [theme, setTheme]);
 React.useEffect(() => {
  // Reject invalid cross-tab values before next-themes 0.2's permissive listener.
  const validate = (event: StorageEvent) => {
   if (event.key === null || (event.key === appearanceStorageKey && event.newValue !== null && !isAppearanceMode(event.newValue))) {
    event.stopImmediatePropagation();
    setTheme('light');
   }
  };
  window.addEventListener('storage', validate, true);
  return () => window.removeEventListener('storage', validate, true);
 }, [setTheme]);
 return null;
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
 return <>
  <script data-lms-appearance-bootstrap dangerouslySetInnerHTML={{ __html: appearanceBootstrap }} />
  <NextThemesProvider attribute="class" defaultTheme="light" enableSystem storageKey={appearanceStorageKey} {...props}>
   <AppearanceGuard />
   {children}
  </NextThemesProvider>
 </>;
}
