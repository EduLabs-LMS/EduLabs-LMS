'use client';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from 'react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import { ActionMenu, type MenuAction } from '@/frontend/components/design/action-menu';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { ChoiceGroup } from '@/frontend/components/design/controls';
import { Dialog } from '@/frontend/components/design/dialog';
import { Field } from '@/frontend/components/design/field';
import { Icon } from '@/frontend/components/design/icon';
import { DesignSkeleton } from '@/frontend/components/design/skeleton';
import { StatusPill } from '@/frontend/components/design/status-pill';
import { usePhone } from '@/frontend/components/design/use-phone';
import { L, useLanguage } from '@/frontend/components/language-provider';
import { actionToast } from '@/frontend/lib/action-toast';
import type { MessageKey } from '@/frontend/locales/messages';
import { SectionError } from '@/frontend/features/teacher-home/parts';
import type { ContentEdit } from '@/shared/contracts/course-content';
import { buildTree, chapterRefusal, contentFailure, deleteChapterEdit, lessonRefusal, moveLessonEdit, reorderChaptersEdit, reorderLessonsEdit, withChapterOrder, withLessonOrder, type ContentFailure, type CourseStructure, type Refusal, type TreeChapter, type TreeLesson } from '@/shared/course-content';
import { cn } from '@/shared/utils';
import { countWord, refusalSentences } from './content-words';
import { dropSide, useRowDrag } from './use-row-drag';

type RowKind = 'chapter' | 'lesson';
type Form = { type: 'add_chapter' } | { type: 'add_lesson'; chapterId: string } | { type: 'rename'; kind: RowKind; id: string };
type Shown = { failure: ContentFailure; at: string; scope: RowKind };
type Target = { id: string; part: 'menu' | 'handle' | 'input' | 'button' };
type Popup = { type: 'sheet'; kind: RowKind; id: string } | { type: 'confirm'; kind: RowKind; id: string } | { type: 'move'; id: string; target: string } | { type: 'unpublish'; id: string };
/** `disabled` (with `reason`): nothing to do here right now, such as Move up on the first row. `unavailable` (with `note`): refused, such as Delete of a lesson students started. */
type RowAction = { key: string; label: string; sheetLabel?: string; onSelect: () => void; destructive?: boolean; disabled?: boolean; reason?: string; unavailable?: boolean; note?: string };

const ADD_CHAPTER = 'add-chapter';
const failureWords: Partial<Record<ContentFailure['kind'], MessageKey>> = {
  changed: 'tc.content.changed', denied: 'tc.content.denied', invalid: 'tc.content.invalid', failed: 'tc.content.failed', too_large: 'tc.content.too_large', unknown: 'tc.error.unknown', signin: 'tc.error.signin',
};

/** The tree of the course: chapters and lessons in order. Everything comes from public.course_structure, and every change goes through the server, which answers with a fresh read. */
export function CourseContent({ courseId }: { courseId: string }) {
  const { t } = useLanguage();
  const phone = usePhone();
  const url = `/api/teacher/courses/${courseId}/content`;
  const [structure, setStructure] = useState<CourseStructure | null>(null);
  const [readFailure, setReadFailure] = useState<{ status: number | null } | null>(null);
  const [reading, setReading] = useState(false);
  const [shown, setShown] = useState<Shown | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [draft, setDraft] = useState('');
  const [nameError, setNameError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [popup, setPopup] = useState<Popup | null>(null);
  const [live, setLive] = useState('');
  const [focusTick, setFocusTick] = useState(0);
  const sending = useRef(false);
  const lastRead = useRef(0);
  const firstRead = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<Target | null>(null);
  const popupOpen = useRef(false);
  const afterClose = useRef<(() => void) | null>(null);

  const tree = useMemo(() => structure ? buildTree(structure) : [], [structure]);
  const canEdit = Boolean(structure?.canEdit && !structure.archived);
  const totalLessons = structure?.lessons.length ?? 0;

  // ---- reading
  const read = useCallback(async () => {
    const mine = ++lastRead.current;
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw Object.assign(new Error('content'), { status: response.status });
    const next = await response.json() as CourseStructure;
    if (mine === lastRead.current) setStructure(next);
    return next;
  }, [url]);
  const loadFirst = useCallback(() => {
    setReadFailure(null); setReading(true);
    read().then(next => {
      if (firstRead.current && window.matchMedia('(max-width: 767px)').matches) setCollapsed(new Set(buildTree(next).slice(1).map(c => c.id)));
      firstRead.current = false;
    }).catch((e: unknown) => setReadFailure({ status: (e as { status?: number }).status ?? null })).finally(() => setReading(false));
  }, [read]);
  useEffect(() => { loadFirst(); }, [loadFirst]);

  // ---- focus: a row keeps the focus after each action, once any dialog has handed it back
  const applyFocus = useCallback(() => {
    const target = focusTarget.current;
    if (!target || popupOpen.current || !root.current) return;
    const find = (part: string) => root.current?.querySelector<HTMLElement>(`[data-focus-id="${target.id}"][data-focus-part="${part}"]`);
    const element = find(target.part) ?? find('menu');
    if (element) { element.focus(); focusTarget.current = null; }
  }, []);
  const focusOn = useCallback((target: Target) => { focusTarget.current = target; setFocusTick(n => n + 1); }, []);
  useEffect(() => { applyFocus(); }, [applyFocus, focusTick, structure, form, collapsed]);

  const say = useCallback((text: string) => { setLive(text); actionToast(text); }, []);

  // ---- writing, one at a time: the next change needs the versions this one returns
  const send = useCallback(async (edit: ContentEdit, options: { at: string; scope: RowKind; optimistic?: CourseStructure }): Promise<string | null> => {
    if (sending.current || !structure) return null;
    const before = structure;
    sending.current = true; setBusy(true); setShown(null);
    if (options.optimistic) setStructure(options.optimistic);
    try {
      let response: Response | null = null;
      try { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit) }); } catch { response = null; }
      const body = response ? await response.json().catch(() => null) as { id?: string; structure?: CourseStructure | null } | null : null;
      if (response?.ok && body?.id) {
        lastRead.current++;
        if (body.structure) setStructure(body.structure);
        else await read().catch(() => setShown({ failure: { kind: 'unknown' }, at: options.at, scope: options.scope }));
        return body.id;
      }
      // Never leave an order on the screen that the server did not take.
      setStructure(before);
      const failure = contentFailure(response ? response.status : null, body);
      setShown({ failure, at: options.at, scope: options.scope });
      if (failure.kind === 'archived') { setStructure({ ...before, archived: true, canEdit: false }); setForm(null); }
      if (failure.kind === 'archived' || failure.kind === 'refused') void read().catch(() => undefined);
      return null;
    } finally { sending.current = false; setBusy(false); }
  }, [read, structure, url]);

  const reload = useCallback(async () => {
    setReading(true);
    try { await read(); setShown(null); }
    catch { setShown(current => current && { ...current, failure: { kind: 'unknown' } }); }
    finally { setReading(false); }
  }, [read]);

  // ---- popups: one at a time, and whatever was chosen in one runs once it has closed and given the focus back
  const openPopup = (next: Popup) => { popupOpen.current = true; setPopup(next); };
  const closePopup = (then?: () => void) => { afterClose.current = then ?? null; setPopup(null); };
  const onPopupClosed = () => {
    popupOpen.current = false;
    const then = afterClose.current; afterClose.current = null;
    then?.();
    setFocusTick(n => n + 1); // after the render, so a form the action just opened is there to take the focus
  };

  // ---- forms
  const openForm = (next: Form, value = '') => { setForm(next); setDraft(value); setNameError(false); setShown(null); focusOn({ id: next.type === 'add_chapter' ? ADD_CHAPTER : next.type === 'add_lesson' ? next.chapterId : next.id, part: 'input' }); };
  const closeForm = (target: Target) => { setForm(null); setDraft(''); setNameError(false); focusOn(target); };

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    if (!form || busy) return;
    const title = draft.trim();
    if (!title) { setNameError(true); return; }
    setNameError(false);
    if (form.type === 'add_chapter') {
      const id = await send({ action: 'create_chapter', title }, { at: ADD_CHAPTER, scope: 'chapter' });
      if (id) { setForm(null); setDraft(''); focusOn({ id, part: 'menu' }); say(t('tc.content.live.added', { title })); }
    } else if (form.type === 'add_lesson') {
      const id = await send({ action: 'create_lesson', parentId: form.chapterId, title }, { at: form.chapterId, scope: 'chapter' });
      if (id) { setForm(null); setDraft(''); focusOn({ id, part: 'menu' }); say(t('tc.content.live.added', { title })); }
    } else {
      const row = form.kind === 'chapter' ? tree.find(c => c.id === form.id) : tree.flatMap(c => c.lessons).find(l => l.id === form.id);
      if (!row) { setForm(null); return; }
      if (row.title === title) { closeForm({ id: row.id, part: 'menu' }); return; }
      const id = await send({ action: form.kind === 'chapter' ? 'rename_chapter' : 'rename_lesson', id: row.id, updatedAt: row.updatedAt, title }, { at: row.id, scope: form.kind });
      if (id) { setForm(null); setDraft(''); focusOn({ id: row.id, part: 'menu' }); say(t('tc.content.live.renamed', { title })); }
    }
  }

  // ---- moving
  const moveChapter = useCallback(async (from: number, to: number, part: Target['part']) => {
    const edit = reorderChaptersEdit(tree, from, to);
    if (!edit || !structure) return;
    const row = tree[from];
    focusOn({ id: row.id, part });
    const id = await send(edit, { at: row.id, scope: 'chapter', optimistic: withChapterOrder(structure, from, to) });
    focusOn({ id: row.id, part });
    if (id) say(t('tc.content.live.moved', { title: row.title, label: t('tc.content.chapter_n', { n: to + 1 }) }));
  }, [focusOn, say, send, structure, t, tree]);
  const moveLesson = useCallback(async (chapter: TreeChapter, from: number, to: number, part: Target['part']) => {
    const edit = reorderLessonsEdit(chapter, from, to);
    if (!edit || !structure) return;
    const row = chapter.lessons[from];
    focusOn({ id: row.id, part });
    const id = await send(edit, { at: row.id, scope: 'lesson', optimistic: withLessonOrder(structure, chapter.id, from, to) });
    focusOn({ id: row.id, part });
    if (id) say(t('tc.content.live.moved', { title: row.title, label: t('tc.content.lesson_n', { n: `${chapter.number}.${to + 1}` }) }));
  }, [focusOn, say, send, structure, t]);
  const { drag, start } = useRowDrag((scope, from, to) => {
    if (scope === 'chapters') { void moveChapter(from, to, 'handle'); return; }
    const chapter = tree.find(c => c.id === scope);
    if (chapter) void moveLesson(chapter, from, to, 'handle');
  });
  const beginDrag = (event: PointerEvent<HTMLElement>, scope: string, id: string) => { if (!sending.current) start(event, scope, id); };

  async function confirmMove() {
    if (popup?.type !== 'move') return;
    const lesson = tree.flatMap(c => c.lessons).find(l => l.id === popup.id), target = tree.find(c => c.id === popup.target);
    const edit = lesson && target ? moveLessonEdit(lesson, target) : null;
    if (!lesson || !target || !edit) { closePopup(); return; }
    focusOn({ id: lesson.id, part: 'menu' });
    const id = await send(edit, { at: lesson.id, scope: 'lesson' });
    if (id) {
      setCollapsed(current => { const next = new Set(current); next.delete(target.id); return next; });
      say(t('tc.content.live.moved', { title: lesson.title, label: t('tc.content.lesson_n', { n: `${target.number}.${target.lessons.length + 1}` }) }));
    }
    closePopup();
  }

  /** Publish or unpublish one lesson with the version read. Nothing else changes: its parts, homework and every student's work stay as they are. */
  async function setLessonStatus(lesson: TreeLesson, action: 'publish_lesson' | 'unpublish_lesson') {
    focusOn({ id: lesson.id, part: 'menu' });
    const id = await send({ action, id: lesson.id, updatedAt: lesson.updatedAt }, { at: lesson.id, scope: 'lesson' });
    focusOn({ id: lesson.id, part: 'menu' });
    if (id) say(t(action === 'publish_lesson' ? 'tc.content.live.published' : 'tc.content.live.unpublished', { title: lesson.title }));
  }
  async function confirmUnpublish() {
    if (popup?.type !== 'unpublish') return;
    const lesson = tree.flatMap(c => c.lessons).find(l => l.id === popup.id);
    if (lesson) await setLessonStatus(lesson, 'unpublish_lesson');
    closePopup();
  }

  async function confirmDelete() {
    if (popup?.type !== 'confirm') return;
    if (popup.kind === 'lesson') {
      const chapter = tree.find(c => c.lessons.some(l => l.id === popup.id)), index = chapter?.lessons.findIndex(l => l.id === popup.id) ?? -1, lesson = chapter?.lessons[index];
      if (!chapter || !lesson) { closePopup(); return; }
      const id = await send({ action: 'delete_lesson', id: lesson.id, updatedAt: lesson.updatedAt }, { at: lesson.id, scope: 'lesson' });
      if (id) { focusOn({ id: chapter.lessons[index - 1]?.id ?? chapter.lessons[index + 1]?.id ?? chapter.id, part: 'menu' }); say(t('tc.content.live.deleted', { title: lesson.title })); }
      else focusOn({ id: lesson.id, part: 'menu' });
    } else {
      const index = tree.findIndex(c => c.id === popup.id), chapter = tree[index];
      if (!chapter) { closePopup(); return; }
      const id = await send(deleteChapterEdit(chapter), { at: chapter.id, scope: 'chapter' });
      if (id) {
        const neighbour = tree[index - 1]?.id ?? tree[index + 1]?.id;
        focusOn(neighbour ? { id: neighbour, part: 'menu' } : { id: ADD_CHAPTER, part: 'button' });
        say(t('tc.content.live.deleted', { title: chapter.title }));
      } else focusOn({ id: chapter.id, part: 'menu' });
    }
    closePopup();
  }

  // ---- what each row's ⋯ offers
  const deleteAction = (refusal: Refusal | null, kind: RowKind, onSelect: () => void): RowAction => ({
    key: 'delete', label: t('tc.content.delete'), sheetLabel: t(kind === 'lesson' ? 'tc.content.delete_lesson' : 'tc.content.delete_chapter'), destructive: !refusal, unavailable: Boolean(refusal),
    note: refusal ? refusalSentences(t, refusal, kind).join(' ') : undefined, onSelect,
  });
  const chapterActions = (chapter: TreeChapter, index: number): RowAction[] => [
    { key: 'rename', label: t('tc.content.rename'), onSelect: () => openForm({ type: 'rename', kind: 'chapter', id: chapter.id }, chapter.title) },
    { key: 'up', label: t('tc.content.move_up'), disabled: index === 0, reason: t('tc.content.first_chapter'), onSelect: () => void moveChapter(index, index - 1, 'menu') },
    { key: 'down', label: t('tc.content.move_down'), disabled: index === tree.length - 1, reason: t('tc.content.last_chapter'), onSelect: () => void moveChapter(index, index + 1, 'menu') },
    deleteAction(chapterRefusal(chapter), 'chapter', () => openPopup({ type: 'confirm', kind: 'chapter', id: chapter.id })),
  ];
  const lessonActions = (chapter: TreeChapter, lesson: TreeLesson, index: number): RowAction[] => {
    const others = tree.filter(c => c.id !== chapter.id);
    return [
      { key: 'rename', label: t('tc.content.rename'), onSelect: () => openForm({ type: 'rename', kind: 'lesson', id: lesson.id }, lesson.title) },
      lesson.status === 'draft'
        ? { key: 'publish', label: t('tc.content.publish'), onSelect: () => void setLessonStatus(lesson, 'publish_lesson') }
        : { key: 'unpublish', label: t('tc.content.unpublish'), onSelect: () => openPopup({ type: 'unpublish', id: lesson.id }) },
      { key: 'up', label: t('tc.content.move_up'), disabled: index === 0, reason: t('tc.content.first_lesson'), onSelect: () => void moveLesson(chapter, index, index - 1, 'menu') },
      { key: 'down', label: t('tc.content.move_down'), disabled: index === chapter.lessons.length - 1, reason: t('tc.content.last_lesson'), onSelect: () => void moveLesson(chapter, index, index + 1, 'menu') },
      { key: 'other', label: t('tc.content.move_other'), disabled: !others.length, reason: t('tc.content.no_other_chapter'), onSelect: () => openPopup({ type: 'move', id: lesson.id, target: others[0]?.id ?? '' }) },
      deleteAction(lessonRefusal(lesson), 'lesson', () => openPopup({ type: 'confirm', kind: 'lesson', id: lesson.id })),
    ];
  };

  // ---- rendering
  const dialog = <RowPopups popup={popup} tree={tree} busy={busy} onClosed={onPopupClosed} close={closePopup} setPopup={setPopup} confirmDelete={confirmDelete} confirmMove={confirmMove} confirmUnpublish={confirmUnpublish} chapterActions={chapterActions} lessonActions={lessonActions} />;

  const failureBox = (at: string) => shown && shown.at === at ? <FailureBox shown={shown} reload={() => void reload()} reading={reading} /> : null;
  const rowIds = new Set([ADD_CHAPTER, ...tree.flatMap(c => [c.id, ...c.lessons.map(l => l.id)])]);

  const nameForm = (key: string, label: string, submit: string, maxLength: number, onCancel: () => void) => <form data-content-form={key} className="d-content-form" onSubmit={e => void submitForm(e)} onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }}>
    <Field label={label} value={draft} maxLength={maxLength} dir="auto" autoComplete="off" onChange={e => { setDraft(e.target.value); setNameError(false); }} error={nameError ? t('tc.content.empty_name') : undefined} data-focus-id={key} data-focus-part="input" data-content-input="" />
    <div className="d-content-form-actions">
      <Button data-content-cancel onClick={onCancel}><L id="tc.cancel" /></Button>
      <Button type="submit" variant="primary" data-content-submit aria-busy={busy || undefined}>{busy && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}{submit}</Button>
    </div>
  </form>;

  const menu = (id: string, kind: RowKind, label: string, actions: RowAction[]) => phone
    ? <Button variant="icon" aria-label={label} aria-haspopup="dialog" data-focus-id={id} data-focus-part="menu" data-row-menu="" onClick={() => openPopup({ type: 'sheet', kind, id })}><Icon name="more" size={20} /></Button>
    : <ActionMenu label={label} triggerData={{ 'data-focus-id': id, 'data-focus-part': 'menu', 'data-row-menu': '' }} items={actions.map((a): MenuAction => ({ key: a.key, label: a.label, onSelect: a.onSelect, destructive: a.destructive, disabled: a.disabled, unavailable: a.unavailable, note: a.note, data: { 'data-action': a.key } }))} />;

  const lessonRow = (chapter: TreeChapter, lesson: TreeLesson, index: number) => {
    const renaming = form?.type === 'rename' && form.id === lesson.id;
    return <li key={lesson.id} data-lesson={lesson.id} data-drag-row="" data-dragging={drag?.id === lesson.id ? '' : undefined} data-drop={dropSide(drag, chapter.id, index)} className="d-content-lesson">
      {renaming ? nameForm(lesson.id, t('tc.content.lesson_name'), t('tc.content.save'), 200, () => closeForm({ id: lesson.id, part: 'menu' }))
        : <div className="d-content-row">
          {canEdit && !phone && <button type="button" className="d-content-grip d-focus" aria-label={t('tc.content.drag_lesson', { n: lesson.label })} data-focus-id={lesson.id} data-focus-part="handle" data-drag-handle="" onPointerDown={e => beginDrag(e, chapter.id, lesson.id)} onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); if (!sending.current) void moveLesson(chapter, index, index + (e.key === 'ArrowUp' ? -1 : 1), 'handle'); } }}><Icon name="grip" /></button>}
          <span data-lesson-number className="d-content-number"><bdi dir="ltr">{lesson.label}</bdi></span>
          <span className="d-content-lesson-body">
            <span data-lesson-title className="d-content-lesson-title"><bdi dir="auto">{lesson.title}</bdi></span>
            <span className="d-content-pills">
              {lesson.status === 'draft' && <StatusPill tone="neutral" data-lesson-draft=""><L id="tc.content.draft" /></StatusPill>}
              <HomeworkPill lesson={lesson} />
            </span>
          </span>
          {canEdit && menu(lesson.id, 'lesson', t('tc.content.actions_lesson', { n: lesson.label }), lessonActions(chapter, lesson, index))}
        </div>}
      {failureBox(lesson.id)}
    </li>;
  };

  const chapterRow = (chapter: TreeChapter, index: number) => {
    const open = !collapsed.has(chapter.id), renaming = form?.type === 'rename' && form.id === chapter.id, adding = form?.type === 'add_lesson' && form.chapterId === chapter.id;
    const name = t('tc.content.chapter_n', { n: chapter.number });
    return <li key={chapter.id} data-chapter={chapter.id} data-drag-row="" data-dragging={drag?.id === chapter.id ? '' : undefined} data-drop={dropSide(drag, 'chapters', index)} className="d-content-chapter">
      {renaming ? nameForm(chapter.id, t('tc.content.chapter_name'), t('tc.content.save'), 120, () => closeForm({ id: chapter.id, part: 'menu' }))
        : <div className="d-content-row">
          {canEdit && !phone && <button type="button" className="d-content-grip d-focus" aria-label={t('tc.content.drag_chapter', { n: chapter.number })} data-focus-id={chapter.id} data-focus-part="handle" data-drag-handle="" onPointerDown={e => beginDrag(e, 'chapters', chapter.id)} onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); if (!sending.current) void moveChapter(index, index + (e.key === 'ArrowUp' ? -1 : 1), 'handle'); } }}><Icon name="grip" /></button>}
          <Button variant="icon" aria-expanded={open} aria-label={t(open ? 'tc.content.collapse' : 'tc.content.expand', { n: chapter.number })} data-chapter-toggle="" onClick={() => setCollapsed(current => { const next = new Set(current); if (open) next.add(chapter.id); else next.delete(chapter.id); return next; })}><Icon name={open ? 'chevron-down' : 'chevron'} /></Button>
          <span className="d-row-body">
            <span data-chapter-label className="d-content-eyebrow">{name}</span>
            <h3 data-chapter-title className="d-content-chapter-title"><bdi dir="auto">{chapter.title}</bdi></h3>
          </span>
          <span data-chapter-count className="d-meta">{chapter.lessons.length ? countWord(t, 'lesson', chapter.lessons.length) : t('tc.content.no_lessons')}</span>
          {canEdit && menu(chapter.id, 'chapter', t('tc.content.actions_chapter', { n: chapter.number }), chapterActions(chapter, index))}
        </div>}
      {failureBox(chapter.id)}
      {open && (chapter.lessons.length > 0 || canEdit) && <div className="d-content-lessons">
        {chapter.lessons.length > 0 && <ol className="d-content-list">{chapter.lessons.map((lesson, i) => lessonRow(chapter, lesson, i))}</ol>}
        {canEdit && (adding
          ? nameForm(chapter.id, t('tc.content.new_lesson', { n: chapter.number }), t('tc.content.add'), 200, () => closeForm({ id: `add-lesson-${chapter.id}`, part: 'button' }))
          : <Button variant="tertiary" data-add-lesson={chapter.id} data-focus-id={`add-lesson-${chapter.id}`} data-focus-part="button" onClick={() => openForm({ type: 'add_lesson', chapterId: chapter.id })}><Icon name="plus" size={16} />{t(chapter.lessons.length ? 'tc.content.add_lesson' : 'tc.content.add_first')}</Button>)}
      </div>}
    </li>;
  };

  const summary = <span data-content-summary className="d-meta">
    {countWord(t, 'chapter', tree.length)} · {totalLessons ? countWord(t, 'lesson', totalLessons) : t('tc.content.no_lessons')}{canEdit && !phone ? ` · ${t('tc.content.hint_drag')}` : ''}
  </span>;

  return <div ref={root} className="d-stack-lg">
    <section aria-labelledby="tc-c" data-section="content" data-tour="course-lessons" className="d-card d-card--pad d-stack-sm">
      <div className="d-content-head">
        <div className="d-stack-xs">
          <h2 id="tc-c" className="d-section"><L id="tc.content.title" /></h2>
          {tree.length > 0 && summary}
        </div>
        {canEdit && form?.type !== 'add_chapter' && <Button variant="primary" data-add-chapter data-tour="content-add-chapter" data-focus-id={ADD_CHAPTER} data-focus-part="button" onClick={() => openForm({ type: 'add_chapter' })}><Icon name="plus" size={18} /><L id="tc.content.add_chapter" /></Button>}
      </div>

      {!structure && !readFailure && <div role="status" data-state="loading" className="d-stack-sm"><DesignSkeleton className="h-11 w-full" /><DesignSkeleton className="h-11 w-full" /><span className="sr-only"><L id="th.state.loading" /></span></div>}
      {!structure && readFailure && <SectionError status={readFailure.status} onRetry={loadFirst} pending={reading} />}

      {structure && structure.archived && <p data-content-readonly="archived" className="d-content-line"><Icon name="info" /><L id="tc.content.archived" /></p>}
      {structure && !structure.archived && !structure.canEdit && <p data-content-readonly="staff" className="d-content-line"><Icon name="info" /><L id="tc.content.read_only" /></p>}
      {shown && !rowIds.has(shown.at) && <FailureBox shown={shown} reload={() => void reload()} reading={reading} />}

      {structure && tree.length === 0 && form?.type !== 'add_chapter' && <div data-content-empty className="d-stack-xs">
        <p className="d-label"><L id="tc.content.empty_title" /></p>
        <p className="d-body"><L id={canEdit ? 'tc.content.empty_body' : 'tc.content.empty_read_only'} /></p>
      </div>}
      {tree.length > 0 && <ol data-tour="content-rows" data-content-chapters className="d-content-list">{tree.map(chapterRow)}</ol>}
      {canEdit && form?.type === 'add_chapter' && nameForm(ADD_CHAPTER, t('tc.content.new_chapter'), t('tc.content.add'), 120, () => closeForm({ id: ADD_CHAPTER, part: 'button' }))}
      {failureBox(ADD_CHAPTER)}
    </section>
    {structure && <p data-content-note className="d-content-line"><Icon name="info" /><span><L id="tc.content.note" /></span></p>}
    <p role="status" data-content-live className="sr-only">{live}</p>
    {dialog}
  </div>;
}

function HomeworkPill({ lesson }: { lesson: TreeLesson }) {
  const { t } = useLanguage();
  if (lesson.homework > 0) return <StatusPill tone="info" data-lesson-homework="published">{countWord(t, 'homework', lesson.homework)}</StatusPill>;
  if (lesson.draftHomework > 0) return <StatusPill tone="warning" data-lesson-homework="draft"><L id="tc.content.draft_homework" /></StatusPill>;
  return <StatusPill tone="neutral" data-lesson-homework="none"><L id="tc.content.no_homework" /></StatusPill>;
}

/** Said where it happened. A stale write offers Reload and leaves what was typed alone. */
function FailureBox({ shown, reload, reading }: { shown: Shown; reload: () => void; reading: boolean }) {
  const { t } = useLanguage();
  const { failure, scope } = shown;
  if (failure.kind === 'archived') return null;
  const words = failure.kind === 'refused' ? refusalSentences(t, failure.refusal, scope).join(' ') : t(failureWords[failure.kind] ?? 'tc.content.failed');
  return <div role="alert" data-state="error" data-failure={failure.kind} className="d-alert">
    <p className="d-alert-text"><AlertCircle aria-hidden className="d-alert-icon" /><span>{words}</span></p>
    {(failure.kind === 'changed' || failure.kind === 'unknown') && <Button data-content-reload onClick={reload} disabled={reading}>{reading && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="tc.reload" /></Button>}
    {failure.kind === 'signin' && <Link href="/sign-in" className={buttonClass('secondary')}><L id="th.state.signin" /></Link>}
  </div>;
}

function RowPopups({ popup, tree, busy, onClosed, close, setPopup, confirmDelete, confirmMove, confirmUnpublish, chapterActions, lessonActions }: {
  popup: Popup | null; tree: TreeChapter[]; busy: boolean; onClosed: () => void; close: (then?: () => void) => void; setPopup: (popup: Popup) => void; confirmDelete: () => Promise<void>; confirmMove: () => Promise<void>; confirmUnpublish: () => Promise<void>;
  chapterActions: (chapter: TreeChapter, index: number) => RowAction[]; lessonActions: (chapter: TreeChapter, lesson: TreeLesson, index: number) => RowAction[];
}) {
  const { t } = useLanguage();
  const chapterIndex = popup && popup.type !== 'move' && popup.type !== 'unpublish' && popup.kind === 'chapter' ? tree.findIndex(c => c.id === popup.id) : -1;
  const chapter = chapterIndex >= 0 ? tree[chapterIndex] : undefined;
  const lessonId = popup && (popup.type === 'move' || popup.type === 'unpublish' || popup.kind === 'lesson') ? popup.id : null;
  const parent = lessonId ? tree.find(c => c.lessons.some(l => l.id === lessonId)) : undefined;
  const lessonIndex = parent?.lessons.findIndex(l => l.id === lessonId) ?? -1;
  const lesson = parent?.lessons[lessonIndex];
  const dismiss = (open: boolean) => { if (!open && !busy) close(); };
  const danger = <Loader2 aria-hidden className="h-4 w-4 animate-spin" />;

  if (popup?.type === 'sheet' && (chapter || (parent && lesson))) {
    const actions = chapter ? chapterActions(chapter, chapterIndex) : lessonActions(parent!, lesson!, lessonIndex);
    const eyebrow = chapter ? t('tc.content.chapter_n', { n: chapter.number }) : t('tc.content.lesson_n', { n: lesson!.label });
    return <Dialog open onOpenChange={dismiss} onClosed={onClosed} data-content-sheet="" title={<><span className="d-content-eyebrow">{eyebrow}</span><br /><bdi dir="auto">{(chapter ?? lesson)!.title}</bdi></>}>
      <div className="d-sheet-list">
        {/* Off is aria-disabled, never the disabled attribute: the row stays reachable and says why ("Already the first lesson"). */}
        {actions.map(a => { const off = Boolean(a.unavailable || a.disabled), why = a.disabled && a.reason ? `sheet-why-${a.key}` : a.unavailable && a.note ? `sheet-note-${a.key}` : undefined;
          return <button key={a.key} type="button" data-action={a.key} aria-disabled={off || undefined} aria-describedby={off ? why : undefined} className={cn('d-sheet-item', a.destructive && !off && 'd-sheet-item--danger')} onClick={() => { if (!off) close(a.onSelect); }}>
            <span className="d-stack-xs"><span>{a.sheetLabel ?? a.label}</span>{a.disabled && a.reason && <span id={`sheet-why-${a.key}`} data-action-reason={a.key} className="d-meta">{a.reason}</span>}</span>
          </button>; })}
      </div>
      {actions.filter(a => a.note).map(a => <p key={a.key} id={`sheet-note-${a.key}`} data-action-note={a.key} className="d-meta">{a.note}</p>)}
      {!chapter && !actions.some(a => a.note) && <p className="d-meta"><L id="tc.content.sheet_note" /></p>}
    </Dialog>;
  }

  if (popup?.type === 'confirm' && (chapter || lesson)) {
    const title = (chapter ?? lesson)!.title;
    return <Dialog open onOpenChange={dismiss} onClosed={onClosed} data-content-confirm="" title={t('tc.content.confirm_title', { title })} description={chapter
      ? (chapter.lessons.length ? t('tc.content.confirm_chapter_lessons', { lessons: countWord(t, 'lesson', chapter.lessons.length) }) : t('tc.content.confirm_chapter'))
      : (lesson!.status === 'published' ? t('tc.content.confirm_lesson_published') : t('tc.content.confirm_lesson'))}
      footer={<><Button data-confirm-no disabled={busy} onClick={() => close()}><L id="tc.cancel" /></Button><Button variant="destructive" data-confirm-yes disabled={busy} onClick={() => void confirmDelete()}>{busy && danger}<L id="tc.content.delete" /></Button></>} />;
  }

  if (popup?.type === 'unpublish' && lesson) {
    return <Dialog open onOpenChange={dismiss} onClosed={onClosed} data-content-unpublish="" title={t('tc.content.unpublish_title', { title: lesson.title })} description={t('tc.content.unpublish_body')}
      footer={<><Button data-unpublish-no aria-disabled={busy || undefined} onClick={() => { if (!busy) close(); }}><L id="tc.cancel" /></Button><Button variant="primary" data-unpublish-yes aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={() => { if (!busy) void confirmUnpublish(); }}>{busy && danger}<L id="tc.content.unpublish" /></Button></>} />;
  }

  if (popup?.type === 'move' && lesson && parent) {
    const others = tree.filter(c => c.id !== parent.id);
    return <Dialog open onOpenChange={dismiss} onClosed={onClosed} data-content-move="" title={t('tc.content.move_title', { title: lesson.title })} description={t('tc.content.move_hint')}
      footer={<><Button data-move-no disabled={busy} onClick={() => close()}><L id="tc.cancel" /></Button><Button variant="primary" data-move-yes disabled={busy} onClick={() => void confirmMove()}>{busy && danger}<L id="tc.content.move" /></Button></>}>
      <ChoiceGroup label={t('tc.content.move_to')} value={popup.target} onChange={target => setPopup({ ...popup, target })} options={others.map(c => ({ value: c.id, label: <>{t('tc.content.chapter_n', { n: c.number })}: <bdi dir="auto">{c.title}</bdi></>, 'data-move-target': c.id }))} />
    </Dialog>;
  }
  return null;
}
