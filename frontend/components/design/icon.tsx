import { cn } from '@/shared/utils';

/** One inline stroke set for the teacher app: no emoji, no second icon family. Decorative by default; a control names itself with its own label. */
const paths = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  groups: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 11a3 3 0 1 0 0-6M2 20c0-3 3-5 7-5s7 2 7 5M17 15c3 0 5 2 5 5',
  students: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  courses: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19a2 2 0 0 1 2-2h13',
  homework: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  exams: 'M9 5H6v16h12V5h-3M9 3h6v4H9zM9 12l2 2 4-4',
  reports: 'M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-3',
  bell: 'M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8M12 17v.5',
  logout: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H9',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M5 12l4 4 10-10',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  pin: 'M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  video: 'M4 7h11v10H4zM15 11l5-3v8l-5-3',
  warning: 'M12 3l9 16H3zM12 10v4M12 17v.5',
  'user-plus': 'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM3 21c0-4 3-6 7-6M18 8v6M15 11h6',
  calendar: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4',
  chevron: 'M9 6l6 6-6 6',
  'chevron-down': 'M6 9l6 6 6-6',
  grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
  plus: 'M12 5v14M5 12h14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  back: 'M15 18l-6-6 6-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  close: 'M6 6l12 12M18 6L6 18',
} as const;
export type IconName = keyof typeof paths;
/** Only arrows that point along the reading direction mirror in Arabic. */
const mirrored: readonly IconName[] = ['chevron', 'back'];

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" data-icon={name} className={cn('d-icon', mirrored.includes(name) && 'd-icon-flip', className)}><path d={paths[name]} /></svg>;
}
