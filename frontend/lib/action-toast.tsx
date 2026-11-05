'use client';
import toast from 'react-hot-toast';
import { Icon } from '@/frontend/components/design/icon';
import { motionOn } from '@/frontend/lib/motion';

/**
 * A short word when an action has finished, in the New look only and never with reduced motion (it is part of the motion, owner decision, DECISIONS.md).
 * Call it only where the screen already confirms the action. The screen's own confirmation stays in both looks and is what a screen reader hears, so the toast stays silent.
 */
export function actionToast(message: string) {
  if (!motionOn()) return;
  toast.custom(current => <div data-action-toast aria-hidden="true" className={current.visible ? 'd-toast' : 'd-toast d-toast--leaving'}><Icon name="check" size={16} /><span>{message}</span></div>, { duration: 2400 });
}
