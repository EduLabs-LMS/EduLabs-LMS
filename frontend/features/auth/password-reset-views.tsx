'use client';
import Link from 'next/link';
import type { FormEvent, ReactNode } from 'react';
import { ArrowRight, Ban, Check, Eye, EyeOff, Link2Off, MailCheck, ShieldCheck, TimerOff, WifiOff } from 'lucide-react';
import EduLabsMark from '@/frontend/components/edulabs-mark';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Field } from '@/frontend/components/design/field';
import { useLanguage } from '@/frontend/components/language-provider';
import { passwordMinLength, passwordStrength, type PasswordProblem, type ResetState } from '@/shared/password-reset';

/**
 * The two password-reset screens as pure views: everything they show comes in as props, so each state can be drawn (and tested) without Firebase.
 * They use the sign-in page's own surface (`d-card d-auth`, the brand column, the same fields and buttons), so both looks and both languages follow it.
 */

function Shell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
 const { t } = useLanguage();
 return <section data-auth-surface data-password-reset className="d-card d-auth">
  <div className="d-auth-aside">
   <div className="d-auth-brand"><EduLabsMark grow lightShadowOnly className="h-12 w-12" /><span className="d-auth-word">EduLabs</span></div>
   <div className="d-auth-pitch"><EduLabsMark lightShadowOnly grow className="mx-auto h-48 w-48" /></div>
   <p className="d-auth-note"><ShieldCheck className="h-4 w-4 shrink-0" />{t('pr.aside')}</p>
  </div>
  <div className="d-auth-main">
   <header className="d-auth-head"><h1 className="d-title">{title}</h1>{subtitle && <p className="d-auth-sub">{subtitle}</p>}</header>
   {children}
  </div>
 </section>;
}

/** A finished state: an icon, a heading, plain words and the next steps. */
function Outcome({ icon, title, tone = 'plain', children, live }: { icon: ReactNode; title: string; tone?: 'plain' | 'good' | 'bad'; children: ReactNode; live?: boolean }) {
 return <div className="d-auth-outcome" data-tone={tone} role={live ? 'status' : undefined}>
  <span className="d-auth-outcome-icon" aria-hidden="true">{icon}</span>
  <h2 className="d-auth-outcome-title">{title}</h2>
  {children}
 </div>;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Forgot your password?
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type ForgotError = 'bad_email' | 'wait' | 'unavailable' | 'failed' | null;
export type ForgotViewProps = {
 phase: 'form' | 'sending' | 'sent';
 email: string; onEmail(value: string): void; error: ForgotError;
 /** Seconds until "Send again" works again. */ cooldown: number;
 onSubmit(): void; onResend(): void; signInHref: string;
};

export function ForgotPasswordView({ phase, email, onEmail, error, cooldown, onSubmit, onResend, signInHref }: ForgotViewProps) {
 const { t } = useLanguage();
 const submit = (event: FormEvent) => { event.preventDefault(); onSubmit(); };
 const errorText = error ? t(error === 'bad_email' ? 'pr.forgot.bad_email' : error === 'wait' ? 'pr.forgot.wait' : error === 'unavailable' ? 'pr.forgot.unavailable' : 'pr.forgot.failed') : null;
 if (phase === 'sent') return <Shell title={t('pr.forgot.sent_title')}>
  <Outcome live tone="good" icon={<MailCheck className="h-7 w-7" />} title={t('pr.forgot.sent')}>
   <p className="d-auth-sub">{t('pr.forgot.sent_more')}</p>
   {errorText && <p role="alert" className="d-notice d-auth-message">{errorText}</p>}
   <div className="d-auth-actions">
    <Button variant="secondary" block disabled={cooldown > 0} onClick={onResend}>{cooldown > 0 ? t('pr.forgot.resend_in', { seconds: cooldown }) : t('pr.forgot.resend')}</Button>
    <Link className={buttonClass('tertiary', { block: true })} href={signInHref}>{t('pr.forgot.back')}</Link>
   </div>
  </Outcome>
 </Shell>;
 const busy = phase === 'sending';
 return <Shell title={t('pr.forgot.title')} subtitle={t('pr.forgot.intro')}>
  <form onSubmit={submit} noValidate className="d-auth-form"><fieldset disabled={busy} className="d-auth-fields">
   <Field label={t('pr.forgot.email')} required type="email" inputMode="email" dir="ltr" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} value={email} onChange={(e) => onEmail(e.target.value)} error={error === 'bad_email' ? errorText : undefined} />
   {errorText && error !== 'bad_email' && <p role="alert" className="d-notice d-auth-message">{errorText}</p>}
   <Button type="submit" variant="primary" size="lg" block>{busy ? t('pr.forgot.sending') : t('pr.forgot.send')}<ArrowRight className="d-auth-arrow h-4 w-4" /></Button>
  </fieldset></form>
  <p className="d-auth-links"><Link className="d-inline-link" href={signInHref}>{t('pr.forgot.back')}</Link></p>
 </Shell>;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Choose a new password
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type ResetViewProps = {
 state: ResetState;
 password: string; confirm: string; show: boolean;
 onPassword(value: string): void; onConfirm(value: string): void; onToggle(): void;
 /** What is wrong with the pair; the screen shows it once the person has pressed Save or typed in both fields. */
 problem: PasswordProblem | null; showProblem: boolean;
 onSubmit(): void; onRetry(): void; forgotHref: string; signInHref: string;
};

const levelKeys = ['pr.reset.s0', 'pr.reset.s1', 'pr.reset.s2', 'pr.reset.s3', 'pr.reset.s4'] as const;

export function ResetPasswordView(props: ResetViewProps) {
 const { t } = useLanguage();
 const { state, password, confirm, show, onPassword, onConfirm, onToggle, problem, showProblem, onSubmit, onRetry, forgotHref, signInHref } = props;
 const newLink = <Link className={buttonClass('primary', { size: 'lg', block: true })} href={forgotHref}>{t('pr.reset.new_link')}<ArrowRight className="d-auth-arrow h-4 w-4" /></Link>;
 const back = <Link className={buttonClass('tertiary', { block: true })} href={signInHref}>{t('pr.forgot.back')}</Link>;
 switch (state.status) {
  case 'checking':
   return <Shell title={t('pr.reset.title')}><p role="status" aria-busy="true" className="d-auth-sub d-auth-checking">{t('pr.reset.checking')}</p></Shell>;
  case 'expired':
   return <Shell title={t('pr.reset.title')}><Outcome tone="bad" icon={<TimerOff className="h-7 w-7" />} title={t('pr.reset.expired_title')}><p className="d-auth-sub">{t('pr.reset.expired')}</p><div className="d-auth-actions">{newLink}{back}</div></Outcome></Shell>;
  case 'invalid':
   return <Shell title={t('pr.reset.title')}><Outcome tone="bad" icon={<Link2Off className="h-7 w-7" />} title={t('pr.reset.invalid_title')}><p className="d-auth-sub">{t('pr.reset.invalid')}</p><div className="d-auth-actions">{newLink}{back}</div></Outcome></Shell>;
  case 'disabled':
   return <Shell title={t('pr.reset.title')}><Outcome tone="bad" icon={<Ban className="h-7 w-7" />} title={t('pr.reset.disabled_title')}><p className="d-auth-sub">{t('pr.reset.disabled')}</p><div className="d-auth-actions">{back}</div></Outcome></Shell>;
  case 'network':
   return <Shell title={t('pr.reset.title')}><Outcome tone="bad" icon={<WifiOff className="h-7 w-7" />} title={t('pr.reset.network_title')}><p className="d-auth-sub">{t('pr.reset.network')}</p><div className="d-auth-actions"><Button variant="primary" size="lg" block onClick={onRetry}>{t('pr.reset.retry')}</Button>{back}</div></Outcome></Shell>;
  case 'done':
   return <Shell title={t('pr.reset.done_title')}><Outcome live tone="good" icon={<Check className="h-7 w-7" />} title={t('pr.reset.done_title')}><p className="d-auth-sub">{t('pr.reset.done')}</p><div className="d-auth-actions"><Link className={buttonClass('primary', { size: 'lg', block: true })} href={signInHref}>{t('pr.reset.signin')}<ArrowRight className="d-auth-arrow h-4 w-4" /></Link></div></Outcome></Shell>;
 }
 // ready or saving
 const busy = state.status === 'saving';
 const level = passwordStrength(password);
 const matches = confirm.length > 0 && password === confirm;
 const problemText = showProblem && problem && problem !== 'mismatch' ? t(problem === 'too_long' ? 'pr.reset.weak_server' : 'pr.reset.too_short') : null;
 const confirmError = showProblem && problem === 'mismatch' ? t('pr.reset.not_match') : null;
 const toggle = <button type="button" aria-label={show ? t('pr.reset.hide') : t('pr.reset.show')} aria-pressed={show} className="d-field-toggle" onClick={onToggle}>{show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>;
 return <Shell title={t('pr.reset.title')} subtitle={state.email ? t('pr.reset.for', { email: '⁦' + state.email + '⁩' }) : undefined}>
  <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }} noValidate className="d-auth-form"><fieldset disabled={busy} className="d-auth-fields">
   <Field label={t('pr.reset.new')} required type={show ? 'text' : 'password'} autoComplete="new-password" dir="ltr" value={password} onChange={(e) => onPassword(e.target.value)} trailing={toggle} error={problemText} hint={<span data-met={password.length >= passwordMinLength ? 'true' : 'false'}>{t('pr.reset.rule')}{password.length >= 1 && password.length < passwordMinLength ? ` (${password.length}/${passwordMinLength})` : ''}</span>} />
   {password.length > 0 && <div className="d-strength" data-level={level}>
    <div className="d-strength-bars" aria-hidden="true">{[1, 2, 3, 4].map((n) => <span key={n} className="d-strength-bar" data-on={level >= n ? 'true' : 'false'} />)}</div>
    <p className="d-strength-text" role="status">{t('pr.reset.strength', { level: t(levelKeys[level]) })}</p>
   </div>}
   <Field label={t('pr.reset.confirm')} required type={show ? 'text' : 'password'} autoComplete="new-password" dir="ltr" value={confirm} onChange={(e) => onConfirm(e.target.value)} error={confirmError} hint={confirm.length > 0 && !confirmError ? t(matches ? 'pr.reset.match' : 'pr.reset.mismatch') : undefined} />
   <p className="d-field-hint">{t('pr.reset.strength_tip')}</p>
   {state.notice && <p role="alert" className="d-notice d-auth-message">{state.notice === 'weak' ? t('pr.reset.weak_server') : t('pr.reset.network')}</p>}
   <Button type="submit" variant="primary" size="lg" block>{busy ? t('pr.reset.saving') : t('pr.reset.save')}<ArrowRight className="d-auth-arrow h-4 w-4" /></Button>
  </fieldset></form>
 </Shell>;
}
