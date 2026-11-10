import { z } from 'zod';

/** What the Content section may ask for. Every change to an existing row sends the version it read; the database compares it and decides who may do this. */
const id = z.string().uuid();
const version = z.string().datetime({ offset: true });
const noControl = /^[^\p{Cc}]+$/u;
const chapterTitle = z.string().trim().min(1).max(120).regex(noControl);
const lessonTitle = z.string().trim().min(1).max(200).regex(noControl);
const items = z.array(z.object({ id, updated_at: version }).strict()).max(501);

export const contentEdit = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_chapter'), title: chapterTitle }).strict(),
  z.object({ action: z.literal('rename_chapter'), id, updatedAt: version, title: chapterTitle }).strict(),
  z.object({ action: z.literal('delete_chapter'), id, updatedAt: version, items }).strict(),
  z.object({ action: z.literal('reorder_modules'), items }).strict(),
  z.object({ action: z.literal('create_lesson'), parentId: id, title: lessonTitle }).strict(),
  z.object({ action: z.literal('rename_lesson'), id, updatedAt: version, title: lessonTitle }).strict(),
  z.object({ action: z.literal('delete_lesson'), id, updatedAt: version }).strict(),
  z.object({ action: z.literal('publish_lesson'), id, updatedAt: version }).strict(),
  z.object({ action: z.literal('unpublish_lesson'), id, updatedAt: version }).strict(),
  z.object({ action: z.literal('move_lesson'), id, parentId: id, updatedAt: version, items }).strict(),
  z.object({ action: z.literal('reorder_lessons'), parentId: id, items }).strict(),
]);
export type ContentEdit = z.infer<typeof contentEdit>;
