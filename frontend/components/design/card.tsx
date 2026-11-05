import Link from 'next/link';
import type { ComponentPropsWithoutRef, LiHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/shared/utils';
import { Icon, type IconName } from './icon';
import type { Tone } from './status-pill';

/** A surface with a thin line and a bottom edge. Cards are never nested. */
export function Card({ list = false, className, ...props }: ComponentPropsWithoutRef<'section'> & { list?: boolean }) {
  return <section className={cn('d-card', list ? 'd-card--list' : 'd-card--pad', className)} {...props} />;
}

/** Section heading of a card, with an optional count or link at the end of the line. */
export function CardHead({ id, title, badge, action }: { id: string; title: ReactNode; badge?: ReactNode; action?: ReactNode }) {
  return <div className="d-card-head"><h2 id={id} className="d-section d-card-head-title">{title}{badge}</h2>{action}</div>;
}

/** A small tinted square with one icon. */
export function IconBadge({ name, tone }: { name: IconName; tone: Tone }) {
  return <span aria-hidden className={`d-badge d-badge--${tone}`}><Icon name={name} /></span>;
}

/** One row of a list: something at the start, a title and a meta line, something at the end. With `href` the row's text is one link. `action` wraps the end below the text on a narrow phone. */
export function ListRow({ leading, title, meta, trailing, href, action = false, className, ...rest }: Omit<LiHTMLAttributes<HTMLLIElement>, 'title'> & { leading?: ReactNode; title: ReactNode; meta?: ReactNode; trailing?: ReactNode; href?: string; action?: boolean }) {
  const body = <span className="d-row-body"><span className="d-label">{title}</span>{meta && <span className="d-meta">{meta}</span>}</span>;
  return <li className={cn('d-row', action && 'd-row--action', className)} {...rest}>
    {href
      ? <Link href={href} className="d-row-link">{leading}{body}<Icon name="chevron" className="d-chevron" /></Link>
      : <>{leading}{body}</>}
    {trailing && <span className="d-row-trailing">{trailing}</span>}
  </li>;
}
