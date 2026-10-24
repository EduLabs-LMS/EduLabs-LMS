import { invitationLifetimes, provisioningLimits, provisionTeacherRequest, type ProvisionTeacherRequest } from '@/shared/contracts/platform-provisioning';

/** The in-progress form. It is plain data so inline creation can never discard anything entered earlier. */
export type DraftGrade = { key: string; label: string };
export type DraftSystem = { id: string; label: string; board: string; grades: DraftGrade[] };
export type DraftSubject = { key: string; label: string };
export type Draft = {
 email: string; lifetime: number; systems: DraftSystem[]; subjects: DraftSubject[];
 courseTitle: string; courseTitleTouched: boolean; courseGradeKey: string; courseSubjectKey: string; nextId: number;
};
export type DraftErrorCode = 'email_required' | 'email_invalid' | 'name_required' | 'name_long' | 'board_long' | 'duplicate' | 'system_required' | 'grade_required' | 'subject_required' | 'course_title' | 'course_grade' | 'course_subject' | 'limit' | 'unsafe';
/** Keys: `email`, `lifetime`, `system.<i>`, `system.<i>.board`, `system.<i>.grade.<j>`, `subject.<i>`, `course.title|grade|subject`, `systems`, `subjects`. */
export type DraftErrors = Record<string, DraftErrorCode>;

export const emptyDraft = (): Draft => ({ email: '', lifetime: 7, systems: [{ id: 'sys-1', label: '', board: '', grades: [] }], subjects: [], courseTitle: '', courseTitleTouched: false, courseGradeKey: '', courseSubjectKey: '', nextId: 2 });

const control = /[\u0000-\u001f\u007f]/;
const emailShape = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const norm = (value: string) => value.trim().replace(/\s+/g, ' ');

/** "Physics - Grade 10": the suggested Course title (plain hyphen). Empty until both are chosen. */
export function suggestCourseTitle(draft: Draft): string {
 const subject = draft.subjects.find((s) => s.key === draft.courseSubjectKey)?.label;
 const grade = draft.systems.flatMap((s) => s.grades).find((g) => g.key === draft.courseGradeKey)?.label;
 return subject && grade ? `${norm(subject)} - ${norm(grade)}` : '';
}
/** Keeps the title in step with the subject and grade level until the administrator writes their own. */
export function reconcileTitle(draft: Draft): Draft {
 if (draft.courseTitleTouched) return draft;
 const title = suggestCourseTitle(draft);
 return title === draft.courseTitle ? draft : { ...draft, courseTitle: title };
}
/** Typing marks the title as customized; clearing it hands control back to the suggestion. */
export function setCourseTitle(draft: Draft, text: string): Draft {
 return reconcileTitle({ ...draft, courseTitle: text, courseTitleTouched: text.trim() !== '' });
}
export function chooseCourse(draft: Draft, patch: Partial<Pick<Draft, 'courseGradeKey' | 'courseSubjectKey'>>): Draft {
 return reconcileTitle({ ...draft, ...patch });
}

export function addSystem(draft: Draft): Draft {
 if (draft.systems.length >= provisioningLimits.systems) return draft;
 return { ...draft, systems: [...draft.systems, { id: `sys-${draft.nextId}`, label: '', board: '', grades: [] }], nextId: draft.nextId + 1 };
}
export function removeSystem(draft: Draft, id: string): Draft {
 const doomed = draft.systems.find((s) => s.id === id);
 if (!doomed || draft.systems.length === 1) return draft;
 const gone = new Set(doomed.grades.map((g) => g.key));
 return reconcileTitle({ ...draft, systems: draft.systems.filter((s) => s.id !== id), courseGradeKey: gone.has(draft.courseGradeKey) ? '' : draft.courseGradeKey });
}
export function updateSystem(draft: Draft, id: string, patch: Partial<Pick<DraftSystem, 'label' | 'board'>>): Draft {
 return { ...draft, systems: draft.systems.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}
/** Returns the new draft and the generated key so the caller can select it (e.g. for the first course). */
export function addGrade(draft: Draft, systemId: string, label: string): { draft: Draft; key: string | null } {
 const clean = norm(label);
 const system = draft.systems.find((s) => s.id === systemId);
 if (!clean || !system || system.grades.length >= provisioningLimits.grades) return { draft, key: null };
 if (system.grades.some((g) => g.label.toLowerCase() === clean.toLowerCase())) return { draft, key: null };
 const key = `g${draft.nextId}`;
 return { draft: reconcileTitle({ ...draft, nextId: draft.nextId + 1, systems: draft.systems.map((s) => (s.id === systemId ? { ...s, grades: [...s.grades, { key, label: clean }] } : s)) }), key };
}
export function removeGrade(draft: Draft, key: string): Draft {
 return reconcileTitle({ ...draft, courseGradeKey: draft.courseGradeKey === key ? '' : draft.courseGradeKey, systems: draft.systems.map((s) => ({ ...s, grades: s.grades.filter((g) => g.key !== key) })) });
}
export function addSubject(draft: Draft, label: string): { draft: Draft; key: string | null } {
 const clean = norm(label);
 if (!clean || draft.subjects.length >= provisioningLimits.subjects || draft.subjects.some((s) => s.label.toLowerCase() === clean.toLowerCase())) return { draft, key: null };
 const key = `s${draft.nextId}`;
 return { draft: reconcileTitle({ ...draft, nextId: draft.nextId + 1, subjects: [...draft.subjects, { key, label: clean }] }), key };
}
export function removeSubject(draft: Draft, key: string): Draft {
 return reconcileTitle({ ...draft, courseSubjectKey: draft.courseSubjectKey === key ? '' : draft.courseSubjectKey, subjects: draft.subjects.filter((s) => s.key !== key) });
}

export function validateDraft(draft: Draft): DraftErrors {
 const errors: DraftErrors = {};
 const email = draft.email.trim();
 if (!email) errors.email = 'email_required';
 else if (email.length > 254 || !emailShape.test(email) || control.test(email)) errors.email = 'email_invalid';
 if (!(invitationLifetimes as readonly number[]).includes(draft.lifetime)) errors.lifetime = 'limit';
 const seenSystems = new Set<string>();
 draft.systems.forEach((system, i) => {
  const label = norm(system.label);
  if (!label) errors[`system.${i}`] = 'name_required';
  else if (label.length > 160) errors[`system.${i}`] = 'name_long';
  else if (control.test(label)) errors[`system.${i}`] = 'unsafe';
  else if (seenSystems.has(label.toLowerCase())) errors[`system.${i}`] = 'duplicate';
  seenSystems.add(label.toLowerCase());
  const board = norm(system.board);
  if (board.length > 120) errors[`system.${i}.board`] = 'board_long';
  else if (control.test(board)) errors[`system.${i}.board`] = 'unsafe';
  if (system.grades.length === 0) errors[`system.${i}.grades`] = 'grade_required';
  const seenGrades = new Set<string>();
  system.grades.forEach((grade, j) => {
   const g = norm(grade.label);
   if (!g) errors[`system.${i}.grade.${j}`] = 'name_required';
   else if (g.length > 160) errors[`system.${i}.grade.${j}`] = 'name_long';
   else if (control.test(g)) errors[`system.${i}.grade.${j}`] = 'unsafe';
   else if (seenGrades.has(g.toLowerCase())) errors[`system.${i}.grade.${j}`] = 'duplicate';
   seenGrades.add(g.toLowerCase());
  });
 });
 if (draft.systems.length === 0) errors.systems = 'system_required';
 if (draft.subjects.length === 0) errors.subjects = 'subject_required';
 const seenSubjects = new Set<string>();
 draft.subjects.forEach((subject, i) => {
  const s = norm(subject.label);
  if (!s) errors[`subject.${i}`] = 'name_required';
  else if (s.length > 160) errors[`subject.${i}`] = 'name_long';
  else if (control.test(s)) errors[`subject.${i}`] = 'unsafe';
  else if (seenSubjects.has(s.toLowerCase())) errors[`subject.${i}`] = 'duplicate';
  seenSubjects.add(s.toLowerCase());
 });
 const title = norm(draft.courseTitle);
 if (!title || title.length > 160 || control.test(title)) errors['course.title'] = 'course_title';
 if (!draft.systems.some((s) => s.grades.some((g) => g.key === draft.courseGradeKey))) errors['course.grade'] = 'course_grade';
 if (!draft.subjects.some((s) => s.key === draft.courseSubjectKey)) errors['course.subject'] = 'course_subject';
 return errors;
}

/** Null when anything is invalid; the shared contract is the final gate (the database re-validates too). */
export function toRequest(draft: Draft): ProvisionTeacherRequest | null {
 if (Object.keys(validateDraft(draft)).length) return null;
 const parsed = provisionTeacherRequest.safeParse({
  teacherEmail: draft.email,
  expiresInDays: draft.lifetime,
  systems: draft.systems.map((s) => ({ label: norm(s.label), ...(norm(s.board) ? { examinationBoard: norm(s.board) } : {}), grades: s.grades.map((g) => ({ key: g.key, label: norm(g.label) })) })),
  subjects: draft.subjects.map((s) => ({ key: s.key, label: norm(s.label) })),
  course: { title: norm(draft.courseTitle), gradeKey: draft.courseGradeKey, subjectKey: draft.courseSubjectKey },
 });
 return parsed.success ? parsed.data : null;
}

export const isDirty = (draft: Draft) => JSON.stringify({ ...draft, nextId: 0 }) !== JSON.stringify({ ...emptyDraft(), nextId: 0 });

/** The create flow is four steps; every validation key belongs to exactly one of them. */
export const wizardStepIds = ['teacher', 'education', 'subjects', 'course'] as const;
export function stepOfError(key: string): number {
 if (key === 'email' || key === 'lifetime') return 0;
 if (key.startsWith('system')) return 1;
 if (key === 'subjects' || key.startsWith('subject.')) return 2;
 return 3;
}
export function validateStep(draft: Draft, step: number): DraftErrors {
 return Object.fromEntries(Object.entries(validateDraft(draft)).filter(([key]) => stepOfError(key) === step));
}
export const stepValidity = (draft: Draft): boolean[] => wizardStepIds.map((_, step) => Object.keys(validateStep(draft, step)).length === 0);
/** A step may be opened when it is the current one, an earlier one, or every step before it is valid. */
export const canVisitStep = (draft: Draft, current: number, target: number) => target <= current || stepValidity(draft).slice(0, target).every(Boolean);
