import { en } from './en';
import { ar } from './ar';
import type { Language } from '@/shared/language';
export type MessageKey = keyof typeof en;
export const messages = { en, ar };
const sourceKeys = new Map<string, MessageKey>(Object.entries(en).map(([key, text]) => [text, key as MessageKey]));
export function translate(language: Language, key: MessageKey, values: Record<string, string | number> = {}): string {
 const text = messages[language][key] ?? en[key];
 if (text === undefined) throw new Error('Missing UI translation: ' + key);
 return text.replace(/\{(\w+)\}/g, (match, name: string) => name in values ? String(values[name]) : match);
}
/** Only callers with explicitly platform-owned labels/errors may use this lookup. */
export function translateUi(language: Language, text: string): string {
 const key = sourceKeys.get(text);
 return key ? translate(language, key) : text;
}
