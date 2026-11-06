import type { ContentEdit } from '@/shared/contracts/course-content';

/** The Content section of the course page: pure helpers. public.course_structure gives the data; the database decides everything. */
export type StructureChapter = { id: string; title: string; type: string; number: number; position: number; updatedAt: string };
export type StructureLesson = {
  id: string; chapterId: string; title: string; position: number; status: 'draft' | 'published'; updatedAt: string;
  homework: number; draftHomework: number; deleteBlockers: string[]; contentBlocks: number; hasCover: boolean; parts: number;
};
export type CourseStructure = { archived: boolean; canEdit: boolean; chapters: StructureChapter[]; lessons: StructureLesson[] };

export type TreeLesson = StructureLesson & { label: string };
export type TreeChapter = StructureChapter & { lessons: TreeLesson[] };

/** Chapter N is the stored number. Lessons are numbered by their order, never by their position: positions may have gaps after a move or a delete. */
export function buildTree(structure: CourseStructure): TreeChapter[] {
  const inOrder = <T extends { position: number; id: string }>(rows: T[]) => [...rows].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));
  return inOrder(structure.chapters).map(chapter => ({
    ...chapter,
    lessons: inOrder(structure.lessons.filter(l => l.chapterId === chapter.id)).map((lesson, i) => ({ ...lesson, label: `${chapter.number}.${i + 1}` })),
  }));
}

/** A copy of the list with one entry moved; `to` is where it ends up. */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const copy = [...list];
  const [row] = copy.splice(from, 1);
  copy.splice(to, 0, row);
  return copy;
}
const canMove = (length: number, from: number, to: number) => from !== to && from >= 0 && to >= 0 && from < length && to < length;
const stamps = (rows: readonly { id: string; updatedAt: string }[]) => rows.map(r => ({ id: r.id, updated_at: r.updatedAt }));

export function reorderChaptersEdit(tree: readonly TreeChapter[], from: number, to: number): ContentEdit | null {
  return canMove(tree.length, from, to) ? { action: 'reorder_modules', items: stamps(moved(tree, from, to)) } : null;
}
export function reorderLessonsEdit(chapter: TreeChapter, from: number, to: number): ContentEdit | null {
  return canMove(chapter.lessons.length, from, to) ? { action: 'reorder_lessons', parentId: chapter.id, items: stamps(moved(chapter.lessons, from, to)) } : null;
}
/** The whole new order of the target chapter, with the moved lesson last. Anything else changed there is refused as stale. */
export function moveLessonEdit(lesson: Pick<TreeLesson, 'id' | 'chapterId' | 'updatedAt'>, target: TreeChapter): ContentEdit | null {
  if (lesson.chapterId === target.id) return null;
  return { action: 'move_lesson', id: lesson.id, parentId: target.id, updatedAt: lesson.updatedAt, items: stamps([...target.lessons, lesson]) };
}
/** Every lesson the teacher was shown, so a lesson added in another tab is never removed unseen. */
export const deleteChapterEdit = (chapter: TreeChapter): ContentEdit => ({ action: 'delete_chapter', id: chapter.id, updatedAt: chapter.updatedAt, items: stamps(chapter.lessons) });

/** What the screen shows while a reorder is on its way. The number and positions are what the database will store; a failure puts the earlier copy back. */
export function withChapterOrder(structure: CourseStructure, from: number, to: number): CourseStructure {
  const chapters = moved(buildTree(structure), from, to).map(({ lessons: _lessons, ...chapter }, i) => ({ ...chapter, position: i, number: i + 1 }));
  return { ...structure, chapters };
}
export function withLessonOrder(structure: CourseStructure, chapterId: string, from: number, to: number): CourseStructure {
  const chapter = buildTree(structure).find(c => c.id === chapterId);
  if (!chapter) return structure;
  const order = new Map(moved(chapter.lessons, from, to).map((l, i) => [l.id, i]));
  return { ...structure, lessons: structure.lessons.map(l => order.has(l.id) ? { ...l, position: order.get(l.id)! } : l) };
}

/** Why something cannot be deleted: from the server's refusal, or worked out from the read before anyone tries. */
export type Refusal = { reasons: string[]; contentBlocks: number; covers: number; parts: number; homework: number };
export const lessonRefusal = (lesson: StructureLesson): Refusal | null => lesson.deleteBlockers.length
  ? { reasons: lesson.deleteBlockers, contentBlocks: lesson.contentBlocks, covers: lesson.hasCover ? 1 : 0, parts: lesson.parts, homework: lesson.homework + lesson.draftHomework }
  : null;
/** A chapter counts only the lessons that stop it, as the database does. */
export function chapterRefusal(chapter: TreeChapter): Refusal | null {
  const blocked = chapter.lessons.map(lessonRefusal).filter((r): r is Refusal => r !== null);
  if (!blocked.length) return null;
  const total = (pick: (r: Refusal) => number) => blocked.reduce((sum, r) => sum + pick(r), 0);
  return { reasons: Array.from(new Set(blocked.flatMap(r => r.reasons))), contentBlocks: total(r => r.contentBlocks), covers: total(r => r.covers), parts: total(r => r.parts), homework: total(r => r.homework) };
}

export type ContentFailure = { kind: 'signin' | 'denied' | 'changed' | 'archived' | 'invalid' | 'too_large' | 'failed' | 'unknown' } | { kind: 'refused'; refusal: Refusal };
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
const asRefusal = (value: Record<string, unknown> | null): Refusal => ({
  reasons: Array.isArray(value?.reasons) && value?.reasons.length ? (value.reasons as unknown[]).filter((r): r is string => typeof r === 'string') : ['in_use'],
  contentBlocks: count(value?.contentBlocks), covers: count(value?.covers), parts: count(value?.parts), homework: count(value?.homework),
});
const asObject = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' ? value as Record<string, unknown> : null;
/** The screen's reading of a reply. `status` is null when no reply arrived: the change may or may not have been saved. */
export function contentFailure(status: number | null, body: unknown): ContentFailure {
  if (status === null) return { kind: 'unknown' };
  if (status === 401) return { kind: 'signin' };
  if (status === 403 || status === 404) return { kind: 'denied' };
  if (status === 409) {
    const reply = asObject(body);
    if (reply?.kind === 'archived') return { kind: 'archived' };
    if (reply?.kind === 'refused') return { kind: 'refused', refusal: asRefusal(reply) };
    return { kind: 'changed' };
  }
  if (status === 413) return { kind: 'too_large' };
  if (status === 400 || status === 415) return { kind: 'invalid' };
  return { kind: 'failed' };
}

type DatabaseError = { code?: string | null; message?: string | null; details?: string | null };
/**
 * The server's reading of a database refusal: HTTP status and the body the screen reads.
 * PT409 with reason "archived" is an archived course, any other PT409 a stale version. A module or lesson "unavailable" under 42501 is a row gone since the teacher read it (the caller already
 * passed the course check), so it is a change made elsewhere, not a lack of rights. "Course unavailable" is a refusal.
 */
export function contentReply(error: DatabaseError): { status: number; body: Record<string, unknown> } {
  let detail: Record<string, unknown> | null = null;
  try { detail = asObject(JSON.parse(error.details ?? '')); } catch { detail = null; }
  const code = error.code ?? '';
  if (code === 'PT409') {
    const reasons: unknown[] = Array.isArray(detail?.reasons) ? detail?.reasons as unknown[] : [];
    return reasons.includes('archived') ? { status: 409, body: { kind: 'archived' } } : { status: 409, body: { kind: 'changed' } };
  }
  if (code === '23503') return { status: 409, body: { kind: 'refused', ...asRefusal(detail) } };
  if (code === '42501' && /^(Module|Lesson|Content) unavailable$/.test(error.message ?? '')) return { status: 409, body: { kind: 'changed' } };
  if (code === '42501' || code === 'PGRST116') return { status: 403, body: { kind: 'denied' } };
  if (code === '23514' || code === '22P02' || code === '23505') return { status: 400, body: { kind: 'invalid' } };
  if (code === 'PT413') return { status: 413, body: { kind: 'too_large' } };
  return { status: 503, body: { kind: 'failed' } };
}

/** Which database function a change goes to, and with what. Both functions take the same arguments. */
export function contentCall(courseId: string, edit: ContentEdit) {
  const args = (action: string, id: string | null, parent: string | null, version: string | null, data: Record<string, unknown>) =>
    ({ p_course_id: courseId, p_action: action, p_id: id, p_parent_id: parent, p_updated_at: version, p_data: data });
  switch (edit.action) {
    case 'create_chapter': return { fn: 'edit_course_structure' as const, args: args(edit.action, null, null, null, { title: edit.title }) };
    case 'rename_chapter': case 'rename_lesson': return { fn: 'edit_course_structure' as const, args: args(edit.action, edit.id, null, edit.updatedAt, { title: edit.title }) };
    case 'delete_lesson': return { fn: 'edit_course_structure' as const, args: args(edit.action, edit.id, null, edit.updatedAt, {}) };
    case 'delete_chapter': return { fn: 'edit_course_structure' as const, args: args(edit.action, edit.id, null, edit.updatedAt, { items: edit.items }) };
    case 'move_lesson': return { fn: 'edit_course_structure' as const, args: args(edit.action, edit.id, edit.parentId, edit.updatedAt, { items: edit.items }) };
    case 'create_lesson': return { fn: 'edit_learning_content' as const, args: args(edit.action, null, edit.parentId, null, { title: edit.title }) };
    case 'reorder_modules': return { fn: 'edit_learning_content' as const, args: args(edit.action, null, null, null, { items: edit.items }) };
    case 'reorder_lessons': return { fn: 'edit_learning_content' as const, args: args(edit.action, null, edit.parentId, null, { items: edit.items }) };
  }
}
