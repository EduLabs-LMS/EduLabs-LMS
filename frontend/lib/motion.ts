/** Motion that JavaScript has to start: the New look only, and never with reduced motion. CSS motion carries the same two conditions (design-components.css). */
export const motionOn = () => typeof document !== 'undefined'
  && document.documentElement.dataset.design === 'new'
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
