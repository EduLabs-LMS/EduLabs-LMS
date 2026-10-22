/**
 * Automatic URL names ("slugs") for new courses, so teachers never type technical text.
 * Output always matches the server rule /^[a-z0-9]+(-[a-z0-9]+)*$/ and is at most 100 characters.
 * Pure and deterministic: callers pass the slugs they already know, and retry with `nextSlugCandidate`
 * if the server still answers "already in use".
 */
export const MAX_SLUG_LENGTH = 100;
const BASE_LIMIT = 80;
const SERVER_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Plain Arabic-to-Latin letters so an Arabic-only title still gives a readable, stable URL.
const ARABIC: Record<string, string> = {
	'ا': 'a', 'أ': 'a', 'إ': 'i', 'آ': 'a', 'ٱ': 'a', 'ء': 'a', 'ؤ': 'w', 'ئ': 'y', 'ب': 'b', 'ت': 't', 'ث': 'th', 'ج': 'j',
	'ح': 'h', 'خ': 'kh', 'د': 'd', 'ذ': 'dh', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'sh', 'ص': 's', 'ض': 'd', 'ط': 't',
	'ظ': 'z', 'ع': 'a', 'غ': 'gh', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ة': 'a',
	'و': 'w', 'ي': 'y', 'ى': 'a', 'پ': 'p', 'چ': 'ch', 'گ': 'g', 'ڤ': 'v',
};
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Lowercase ASCII words joined by "-". Empty when nothing usable remains (for example an emoji-only title). */
export function slugBase(title: string): string {
	let out = '';
	for (const char of title.normalize('NFKD')) {
		const arabicDigit = ARABIC_DIGITS.indexOf(char);
		const persianDigit = PERSIAN_DIGITS.indexOf(char);
		out += arabicDigit >= 0 ? String(arabicDigit) : persianDigit >= 0 ? String(persianDigit) : ARABIC[char] ?? char;
	}
	return out
		.toLowerCase()
		.replace(/[̀-ͯـً-ٟ]/g, '') // accents, tatweel, Arabic diacritics
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, BASE_LIMIT)
		.replace(/-+$/g, '');
}

/** "base", then "base-2", "base-3" ... the first one that is not in `taken`. */
export function slugFromTitle(title: string, taken: Iterable<string> = [], fallback = 'course'): string {
	const used = new Set(Array.from(taken, (value) => value.toLowerCase()));
	const base = slugBase(title) || fallback;
	if (!used.has(base)) return base;
	for (let n = 2; n < 1000; n += 1) {
		const candidate = `${base}-${n}`;
		if (!used.has(candidate)) return candidate;
	}
	return `${base}-${Date.now().toString(36)}`;
}

/** Next name to try after the server rejected `slug` as already used: "a" -> "a-2" -> "a-3". */
export function nextSlugCandidate(slug: string): string {
	const match = /^(.*)-(\d+)$/.exec(slug);
	const next = match ? `${match[1]}-${Number(match[2]) + 1}` : `${slug}-2`;
	return next.length > MAX_SLUG_LENGTH ? `${slug.slice(0, MAX_SLUG_LENGTH - 4)}-2`.replace(/-+-/g, '-') : next;
}

export const isValidSlug = (slug: string) => slug.length >= 1 && slug.length <= MAX_SLUG_LENGTH && SERVER_SLUG.test(slug);
