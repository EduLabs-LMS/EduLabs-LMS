'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { L, LocalDate, useLanguage } from '@/frontend/components/language-provider';
import { Button, buttonClass } from '@/frontend/components/design/button';
import { Icon } from '@/frontend/components/design/icon';
import type { LiveClassJoin, LiveClassReply } from '@/shared/live-class';

type Failure = 'denied' | 'off' | 'failed' | 'busy' | 'signin';
type Load = { kind: 'loading' } | { kind: 'error'; failure: Failure } | { kind: 'ready'; reply: LiveClassReply };
type Meeting = { dispose(): void; addListener(event: string, fn: () => void): void };
type MeetingApi = new (domain: string, options: Record<string, unknown>) => Meeting;
declare global { interface Window { JitsiMeetExternalAPI?: MeetingApi } }

const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Cairo' };
/** How often a waiting student asks again whether the class started. */
export const WAIT_POLL_MS = 10000;

async function open(sessionId: string, start: boolean, signal: AbortSignal): Promise<LiveClassReply> {
  const r = await fetch('/api/live-class/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, start }), signal, cache: 'no-store' });
  const body = await r.json().catch(() => ({})) as { kind?: string };
  if (!r.ok) throw Object.assign(new Error('live class'), { failure: (r.status === 401 ? 'signin' : r.status === 403 ? 'denied' : r.status === 404 ? 'off' : r.status === 429 ? 'busy' : 'failed') as Failure });
  return body as LiveClassReply;
}

/** The meeting server's own IFrame API script, loaded once per page. Its address comes from the server (the provider), never from the page. */
const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  if (window.JitsiMeetExternalAPI) return Promise.resolve();
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true; s.referrerPolicy = 'no-referrer';
      s.onload = () => window.JitsiMeetExternalAPI ? resolve() : reject(new Error('no api'));
      s.onerror = () => { scripts.delete(src); s.remove(); reject(new Error('script')); };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

/**
 * The class page (/class/<session>): one Session's EduLabs class, for its Group's staff and students. The database decides who may open it and
 * when (15 minutes before the start to 30 minutes after the end); this page only shows the state it returns: early, waiting for the teacher,
 * ready to start (staff), open (the meeting on the page), ended or cancelled. A waiting page asks again by itself; nothing here writes attendance.
 */
export function LiveClassView({ sessionId, start }: { sessionId: string; start: boolean }) {
  const { language } = useLanguage();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [starting, setStarting] = useState(false);
  const [left, setLeft] = useState(false);
  // "Open in a new tab": the meeting on this page is closed, so nobody is in the class twice.
  const [elsewhere, setElsewhere] = useState(false);
  // Join again / Open it here instead: the meeting waits for the fresh reply (a new token), never rejoining with the previous one first.
  const [renewing, setRenewing] = useState(false);
  const [stage, setStage] = useState<'idle' | 'loading' | 'shown' | 'failed'>('idle');
  const [revision, setRevision] = useState(0);
  const askStart = useRef(start);
  const host = useRef<HTMLDivElement>(null);
  const meeting = useRef<Meeting | null>(null);

  const ask = useCallback(async (begin: boolean, signal: AbortSignal) => {
    try {
      const reply = await open(sessionId, begin, signal);
      setLoad({ kind: 'ready', reply });
      setRenewing(false);
      return reply;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return null;
      setLoad({ kind: 'error', failure: (e as { failure?: Failure }).failure ?? 'failed' });
      setRenewing(false);
      return null;
    }
  }, [sessionId]);

  // First read (staff arriving with ?start=1 start it; the address is then cleaned so a reload only opens). Then: early pages wait for the
  // opening time, waiting pages ask again every few seconds.
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async (begin: boolean) => {
      const reply = await ask(begin, controller.signal);
      if (!reply || controller.signal.aborted) return;
      if (reply.state === 'early') {
        const wait = Date.parse(reply.opensAt) - Date.parse(reply.serverNow);
        timer = setTimeout(() => void run(false), Math.min(Math.max(wait + 1000, 5000), 30 * 60000));
      } else if (reply.state === 'waiting') timer = setTimeout(() => void run(false), WAIT_POLL_MS);
    };
    const begin = askStart.current;
    askStart.current = false;
    if (begin) try { window.history.replaceState(window.history.state, '', window.location.pathname); } catch { /* the address keeps ?start=1; a reload starts nothing new */ }
    void run(begin);
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [ask, revision]);

  const reply = load.kind === 'ready' ? load.reply : null;
  const join: LiveClassJoin | undefined = reply?.state === 'open' && !left && !elsewhere && !renewing ? reply.join : undefined;

  // The meeting itself, on this page. Disposed when leaving the page or the class.
  useEffect(() => {
    if (!join || !host.current) return;
    let gone = false;
    setStage('loading');
    loadScript(join.scriptUrl).then(() => {
      if (gone || !host.current || !window.JitsiMeetExternalAPI) return;
      const api = new window.JitsiMeetExternalAPI(join.domain, { ...join.options, parentNode: host.current, lang: language });
      meeting.current = api;
      api.addListener('videoConferenceJoined', () => { if (!gone) setStage('shown'); });
      api.addListener('readyToClose', () => { if (!gone) setLeft(true); });
      setStage('shown');
    }).catch(() => { if (!gone) setStage('failed'); });
    return () => { gone = true; meeting.current?.dispose(); meeting.current = null; };
  }, [join, language]);

  // A phone: once the meeting is shown (and the "Opening" line above it is gone), bring all of it on screen: its controls are at its bottom
  // edge. The stylesheet sizes it to fit between the header and the bottom tabs.
  useEffect(() => {
    if (stage === 'shown' && host.current && window.matchMedia('(max-width: 767px)').matches) host.current.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [stage]);

  async function startNow() {
    setStarting(true);
    const controller = new AbortController();
    await ask(true, controller.signal);
    setStarting(false);
  }
  const rejoin = () => { setRenewing(true); setLeft(false); setElsewhere(false); setStage('idle'); setRevision(v => v + 1); };
  const back = reply?.staff ? `/teacher/groups/${reply.groupId}` : '/groups';
  // The same meeting as a plain address (the provider builds it; it carries this visit's short-lived token). Opening it closes the one on this page.
  // After the click: removing the link inside its own click would cancel the browser's opening of it.
  const newTab = (primary: boolean) => join && <a href={join.openUrl} target="_blank" rel="noopener noreferrer" data-new-tab onClick={() => { setTimeout(() => setElsewhere(true), 0); }}
    className={primary ? buttonClass('secondary') : 'd-inline-link'}><Icon name="video" size={16} /><L id="lc.new_tab" /></a>;

  return <div data-live-class-page data-state={load.kind === 'ready' ? (left ? 'left' : elsewhere ? 'elsewhere' : load.reply.state) : load.kind} className="d-page d-stack">
    <div className="d-toolbar">
      <Link href={back} data-back className="d-back d-focus"><Icon name="back" size={16} /><span><L id={reply?.staff ? 'lc.back_group' : 'lc.back_groups'} /></span></Link>
    </div>
    <header className="d-page-header">
      <div className="d-page-header-main">
        <h1 className="d-title d-wrap"><bdi dir="auto">{reply?.title || <L id="lc.title" />}</bdi></h1>
        {reply && <p className="d-meta"><bdi dir="auto">{reply.groupName}</bdi> · <LocalDate value={reply.startsAt} options={time} /> – <LocalDate value={reply.endsAt} options={time} /></p>}
      </div>
    </header>
    {(load.kind === 'loading' || (renewing && load.kind === 'ready')) && <p role="status" className="d-body d-live-class-note"><Loader2 aria-hidden className="h-4 w-4 animate-spin" /> <L id="lc.loading" /></p>}
    {load.kind === 'error' && <div role="alert" data-failure={load.failure} className="d-card d-card--pad d-stack">
      <p className="d-body"><L id={load.failure === 'denied' ? 'lc.denied' : load.failure === 'off' ? 'lc.off' : load.failure === 'busy' ? 'lc.busy' : 'lc.failed'} /></p>
      {(load.failure === 'failed' || load.failure === 'busy') && <div><Button type="button" data-retry onClick={() => { setLoad({ kind: 'loading' }); setRevision(v => v + 1); }}><L id="lc.retry" /></Button></div>}
    </div>}
    {reply && !left && reply.state === 'early' && <div role="status" className="d-card d-card--pad d-stack">
      <p className="d-body"><L id="lc.early" values={{ time: new Intl.DateTimeFormat(language, time).format(new Date(reply.opensAt)) }} /></p>
      <p className="d-meta"><L id="lc.early_hint" /></p>
    </div>}
    {reply && !left && reply.state === 'waiting' && <div role="status" data-waiting className="d-card d-card--pad d-stack">
      <p className="d-body d-live-class-note"><Loader2 aria-hidden className="h-4 w-4 animate-spin" /> <L id="lc.waiting" /></p>
      <p className="d-meta"><L id="lc.waiting_hint" /></p>
    </div>}
    {reply && !left && reply.state === 'ready' && <div className="d-card d-card--pad d-stack">
      <p className="d-body"><L id="lc.ready" /></p>
      <p className="d-meta"><L id="lc.ready_hint" /></p>
      <p className="d-meta"><L id="lc.recording_hint" /></p>
      <div><Button type="button" variant="primary" size="lg" data-live-class-start disabled={starting} onClick={() => void startNow()}>{starting && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />}<L id="lc.start" /></Button></div>
    </div>}
    {reply && !left && (reply.state === 'ended' || reply.state === 'cancelled') && <div role="status" className="d-card d-card--pad"><p className="d-body"><L id={reply.state === 'ended' ? 'lc.ended' : 'lc.cancelled'} /></p></div>}
    {left && <div role="status" data-left className="d-card d-card--pad d-stack">
      <p className="d-body"><L id="lc.left" /></p>
      <div className="d-live-class-actions"><Button type="button" variant="primary" size="lg" data-rejoin onClick={rejoin}><L id="lc.rejoin" /></Button><Link href={back} className="d-btn d-btn--secondary d-focus"><L id={reply?.staff ? 'lc.back_group' : 'lc.back_groups'} /></Link></div>
    </div>}
    {elsewhere && !left && reply?.state === 'open' && <div role="status" data-elsewhere className="d-card d-card--pad d-stack">
      <p className="d-body"><L id="lc.elsewhere" /></p>
      <div className="d-live-class-actions"><Button type="button" variant="primary" size="lg" data-back-here onClick={rejoin}><L id="lc.back_here" /></Button><Link href={back} className="d-btn d-btn--secondary d-focus"><L id={reply.staff ? 'lc.back_group' : 'lc.back_groups'} /></Link></div>
    </div>}
    {join && <>
      {stage === 'loading' && <p role="status" className="d-body d-live-class-note"><Loader2 aria-hidden className="h-4 w-4 animate-spin" /> <L id="lc.loading" /></p>}
      {stage === 'failed' && <div role="alert" data-stage-failed className="d-card d-card--pad d-stack"><p className="d-body"><L id="lc.failed" /></p><div className="d-live-class-actions"><Button type="button" data-retry onClick={rejoin}><L id="lc.retry" /></Button>{newTab(true)}</div></div>}
      <div ref={host} data-live-class-stage className="d-live-class-stage" hidden={stage === 'failed'} />
      {stage !== 'failed' && <p className="d-meta d-live-class-note" data-new-tab-hint><L id="lc.new_tab_hint" /> {newTab(false)}</p>}
    </>}
  </div>;
}
