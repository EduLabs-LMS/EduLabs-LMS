'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Tree } from './tree';
import { useLocale } from './preferences';

export function Reveal({ children, kind = 'rise', className = '', delay = 0 }: { children: React.ReactNode; kind?: 'rise' | 'pop' | 'side' | 'split' | 'covers' | 'line'; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState('in');
  useEffect(() => {
    const element = ref.current;
    if (!element || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // SSR and unsupported browsers are fully visible; hide only after observer exists.
    const observer = new IntersectionObserver(([entry]) => setState(entry.isIntersecting ? 'in' : entry.boundingClientRect.top < 0 ? 'up' : 'below'), { threshold: .14, rootMargin: '0px 0px -6% 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={className} data-rv={kind} data-s={state} style={{ '--d': `${Math.min(delay, 450)}ms` } as CSSProperties}>{children}</div>;
}
export function SplitHeading({ children }: { children: string }) {
  return <Reveal kind="split"><h2>{children.split(/\s+/).map((word, i) => <span key={`${word}-${i}`}><span className="w"><span className="wi" style={{ '--i': i } as CSSProperties}>{word}</span></span>{' '}</span>)}</h2></Reveal>;
}
export function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        const root = document.documentElement;
        const maximum = root.scrollHeight - root.clientHeight;
        if (ref.current) ref.current.style.transform = `scaleX(${maximum > 0 ? Math.min(1, Math.max(0, root.scrollTop / maximum)) : 0})`;
        frame = 0;
      });
    };
    window.addEventListener('scroll', draw, { passive: true }); window.addEventListener('resize', draw); draw();
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', draw); window.removeEventListener('resize', draw); };
  }, []);
  return <div ref={ref} className="progress" aria-hidden="true" />;
}
export function Splash() {
  const [phase, setPhase] = useState<'hidden' | 'waiting' | 'go' | 'leave'>('hidden');
  const { locale } = useLocale();
  const skip = () => setPhase('leave');
  useEffect(() => {
    if (location.hash || location.search || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    try { if (sessionStorage.getItem('edulabs:intro-seen')) return; sessionStorage.setItem('edulabs:intro-seen', '1'); } catch { /* Cosmetic preference is optional. */ }
    let active = true;
    setPhase('waiting');
    const fontTimeout = window.setTimeout(() => { if (active) setPhase(p => p === 'waiting' ? 'go' : p); }, 1200);
    void document.fonts?.load('400 1em Caprasimo').then(() => { if (active) setPhase(p => p === 'waiting' ? 'go' : p); });
    return () => { active = false; clearTimeout(fontTimeout); };
  }, []);
  useEffect(() => {
    if (phase !== 'go' && phase !== 'leave') return;
    const timer = window.setTimeout(() => setPhase(phase === 'go' ? 'leave' : 'hidden'), phase === 'go' ? 3100 : 1400);
    return () => clearTimeout(timer);
  }, [phase]);
  if (phase === 'hidden') return null;
  return <><div className={`curtain ${phase === 'leave' ? 'leave' : ''}`} aria-hidden="true" />
    <button type="button" className={`intro ${phase !== 'waiting' ? 'go edu-go' : ''} ${phase === 'leave' ? 'leave' : ''}`} onClick={skip} onKeyDown={e => { if (e.key === 'Escape') skip(); }} aria-label={locale === 'ar' ? 'تخطي المقدمة' : 'Skip introduction'}>
      <span className="intro-in"><span className="intro-tree"><Tree grow /></span><span className="intro-word" dir="ltr">{'EduLabs'.split('').map((letter, i) => <span style={{ '--i': i } as CSSProperties} key={i}>{letter}</span>)}</span><span className="intro-tag">{locale === 'ar' ? 'نُمكّن التعليم الحديث.' : 'Empowering Modern Education.'}</span><span className="edu-splash-skip">{locale === 'ar' ? 'انقر للتخطي' : 'Click to skip'}</span></span>
    </button></>;
}
