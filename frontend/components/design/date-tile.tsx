'use client';
import { LocalDate } from '@/frontend/components/language-provider';

const zone = 'Africa/Cairo';

/** A small calendar page: a coloured band with the weekday, then the day number. The full date belongs in the row's own text, so this is decoration for screen readers. */
export function DateTile({ value }: { value: string }) {
  return <span aria-hidden className="d-tile">
    <span className="d-tile-band"><LocalDate value={value} options={{ timeZone: zone, weekday: 'short' }} /></span>
    <span className="d-tile-day"><LocalDate value={value} options={{ timeZone: zone, day: 'numeric' }} /></span>
  </span>;
}
