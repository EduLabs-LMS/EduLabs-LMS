'use client';
import { createContext, useContext, type ReactNode } from 'react';

const Surface = createContext(false);

/** Set by the teacher frame. A screen a student shares (Language, Appearance, Notifications) reads it and draws itself with the design components there; a student's page stays as it is. It changes the drawing, never what anyone may do. */
export function TeacherSurface({ children }: { children: ReactNode }) { return <Surface.Provider value={true}>{children}</Surface.Provider>; }
export function useTeacherSurface() { return useContext(Surface); }
