'use client';
import { useLanguage } from '@/frontend/components/language-provider';
import type { MessageKey } from '@/frontend/locales/messages';
import { CHAPTER_TYPE_PRESETS, DEFAULT_CHAPTER_TYPE } from '@/shared/chapter-label';

/**
 * Chapter labels in the student's language: a preset type ("Chapter", "Month", …) is translated and the number is written in the page's
 * digits ("الفصل ١ - Motion"). A type the teacher typed themselves is shown as they wrote it. shared/chapter-label.ts stays the English form.
 */
export function useChapterLabel() {
  const { t, number } = useLanguage();
  const typeText = (type: string | null | undefined) => {
    const raw = type?.trim() || DEFAULT_CHAPTER_TYPE;
    const preset = CHAPTER_TYPE_PRESETS.find(p => p.toLowerCase() === raw.toLowerCase());
    return preset ? t(`chapter.type.${preset.toLowerCase()}` as MessageKey) : raw;
  };
  const label = (type: string | null | undefined, n: number | null | undefined) => `${typeText(type)} ${n == null ? '—' : number(n)}`;
  const title = (type: string | null | undefined, n: number | null | undefined, name?: string | null) => name?.trim() ? `${label(type, n)} - ${name.trim()}` : label(type, n);
  return { label, title };
}
