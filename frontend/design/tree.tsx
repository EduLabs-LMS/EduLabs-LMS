import type { CSSProperties } from 'react';
import { tree } from './tree-data';

/** Source geometry and root-first indices, never approximated or rasterized. */
export function Tree({ grow = false, variant = 'green', title, className = '' }: { grow?: boolean; variant?: 'green' | 'white' | 'ink'; title?: string; className?: string }) {
  return <svg className={`edu-tree ${grow ? 'edu-grow' : ''} ${className}`} viewBox={`0 0 ${tree.w} ${tree.h}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} data-variant={variant}>
    {title && <title>{title}</title>}
    {tree.p.map(([d, x, y, index], id) => <path key={id} d={d} style={{ '--i': index, transformOrigin: `${x}px ${y}px` } as CSSProperties} />)}
  </svg>;
}
export function Brand() {
  return <span className="edu-brand" dir="ltr"><Tree /><span>EduLabs</span></span>;
}
