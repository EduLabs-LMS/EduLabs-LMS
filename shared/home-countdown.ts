/**
 * The countdown line on Home: how long until a session starts, in words a person reads once and goes on (owner decision, DECISIONS.md). Pure, so it is tested without a browser.
 * The device's clock is never trusted: the time comes from the server's "now" and the device only measures what has passed since.
 *
 * The words live here and not in the locale files because Arabic has forms with no number in them ("يومين") and the locale tests rightly ask both languages for the same placeholders.
 */
const MINUTE = 60_000, MINUTES_IN_DAY = 1440;

export type CountdownParts = { kind: 'now' } | { kind: 'days'; days: number; hours: number } | { kind: 'hours'; hours: number; minutes: number } | { kind: 'minutes'; minutes: number };

/** Minutes round up, so a countdown never says less time than is left and reaches "starting now" exactly at the start. */
export function countdownParts(targetMs: number, nowMs: number): CountdownParts {
  const total = Math.ceil((targetMs - nowMs) / MINUTE);
  if (!Number.isFinite(total) || total <= 0) return { kind: 'now' };
  if (total > MINUTES_IN_DAY) return { kind: 'days', days: Math.floor(total / MINUTES_IN_DAY), hours: Math.floor((total % MINUTES_IN_DAY) / 60) };
  if (total >= 60) return { kind: 'hours', hours: Math.floor(total / 60), minutes: total % 60 };
  return { kind: 'minutes', minutes: total };
}

type Forms = { one: string; two: string; few: string; many: string; other: string };
const arabic: Record<'day' | 'hour' | 'minute', Forms> = {
  day: { one: 'يوم', two: 'يومين', few: 'أيام', many: 'يومًا', other: 'يوم' },
  hour: { one: 'ساعة', two: 'ساعتين', few: 'ساعات', many: 'ساعة', other: 'ساعة' },
  minute: { one: 'دقيقة', two: 'دقيقتين', few: 'دقائق', many: 'دقيقة', other: 'دقيقة' },
};
const arabicPlural = new Intl.PluralRules('ar');

/** Arabic counts by form: one and two carry the number in the word itself, and the rest take a number. */
function arabicAmount(n: number, unit: keyof typeof arabic, number: (n: number) => string) {
  const category = arabicPlural.select(n) as keyof Forms;
  const word = arabic[unit][category] ?? arabic[unit].other;
  return category === 'one' || category === 'two' ? word : `${number(n)} ${word}`;
}

export function formatCountdown(parts: CountdownParts, language: 'en' | 'ar', number: (n: number) => string = String): string {
  if (language === 'ar') {
    if (parts.kind === 'now') return 'تبدأ الآن';
    const amounts = parts.kind === 'days' ? [parts.days && arabicAmount(parts.days, 'day', number), parts.hours && arabicAmount(parts.hours, 'hour', number)]
      : parts.kind === 'hours' ? [parts.hours && arabicAmount(parts.hours, 'hour', number), parts.minutes && arabicAmount(parts.minutes, 'minute', number)]
      : [arabicAmount(parts.minutes, 'minute', number)];
    return `بعد ${amounts.filter(Boolean).join(' و')}`;
  }
  if (parts.kind === 'now') return 'starting now';
  const pieces = parts.kind === 'days' ? [parts.days && `${number(parts.days)} d`, parts.hours && `${number(parts.hours)} h`]
    : parts.kind === 'hours' ? [parts.hours && `${number(parts.hours)} h`, parts.minutes && `${number(parts.minutes)} min`]
    : [`${number(parts.minutes)} min`];
  return `in ${pieces.filter(Boolean).join(' ')}`;
}

/** The difference between the server's clock and this device's, measured once for each answer from the server. */
export const serverClockOffset = (serverNowMs: number, deviceNowMs: number) => serverNowMs - deviceNowMs;
export const serverTimeFrom = (deviceNowMs: number, offsetMs: number) => deviceNowMs + offsetMs;
/** How long until the server's clock next reaches a whole minute: sessions start on whole minutes, so the line changes when the words really do. */
export const msToNextMinute = (serverNowMs: number) => MINUTE - (((serverNowMs % MINUTE) + MINUTE) % MINUTE);
