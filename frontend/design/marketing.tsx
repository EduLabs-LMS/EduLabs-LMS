'use client';
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Brand, Tree } from './tree';
import { PreferenceControls, useLocale } from './preferences';
import { Reveal, ScrollProgress, Splash, SplitHeading } from './motion';
import { reference as en } from './locales/en';
import { reference as ar } from './locales/ar';

const honest: Record<string, [string, string]> = {
  'hero.lead': ['A home for your teaching and learning. Organize your courses, bring your class together, and make space for what comes next.', 'مكان يجمع التدريس والتعلم. نظّم مقرراتك واجمع طلابك وابدأ خطوتك القادمة.'],
  'getLms': ['Create your account', 'أنشئ حسابك'], 'lms.p': ['Create your organization, author courses and manage draft and published course details. Learning access stays private to authorized groups.', 'أنشئ مؤسستك ومقرراتك وأدر بياناتها ومسوداتها. يظل الوصول للتعلم خاصًا بالمجموعات المصرح لها.'],
  'lms.t1': ['Your own teaching organization', 'مؤسستك التعليمية الخاصة'], 'lms.t2': ['Courses shaped around your curriculum', 'مقررات تناسب منهجك'], 'lms.t4': ['Private groups and contextual permissions', 'مجموعات خاصة وصلاحيات حسب السياق'], 'lms.t5': ['More learning tools are on the way', 'المزيد من أدوات التعلم قادم'],
  'custom.p': ['We are building more ways to shape your classroom. Custom services are a preview, with availability to be announced.', 'نعمل على إتاحة طرق أكثر لتخصيص فصلك. الخدمات المخصصة للمعاينة وسيُعلن عن توفرها لاحقًا.'],
  'bk.link': ['Explore the book concept', 'استكشف فكرة الكتب'], 'how.h2': ['Your classroom, in four steps', 'فصلك الدراسي في أربع خطوات'],
  'how.s1': ['Create your account', 'أنشئ حسابك'], 'how.p1': ['Sign in securely and verify your email.', 'سجل الدخول بأمان وتحقق من بريدك الإلكتروني.'],
  'how.s2': ['Start an organization', 'أنشئ مؤسسة'], 'how.p2': ['Your teaching space, with its own ownership and permissions.', 'مساحتك التعليمية بملكية وصلاحيات خاصة بها.'],
  'how.s3': ['Build your course', 'أنشئ مقررك'], 'how.p3': ['Give your course a title, description and publication settings.', 'أضف عنوان المقرر ووصفه وإعدادات نشره.'],
  'how.s4': ['Bring your class together', 'اجمع طلابك'], 'how.p4': ['Students learn through their authorized course groups.', 'يتعلم الطلاب من خلال مجموعاتهم المصرح بها.'],
  'tch.h2': ['A classroom with personality', 'فصل دراسي بشخصيته الخاصة'], 'tch.intro': ['Illustrative design concepts, not customer websites. Your real courses remain in your learning dashboard.', 'أفكار تصميم توضيحية وليست مواقع لعملاء. مقرراتك الفعلية موجودة في لوحة التعلم.'],
  'hero.cta2': ['Explore the design', 'استكشف التصميم'], 'pl.h2': ['Room to grow', 'مساحة للنمو'], 'pl.intro': ['Plan design preview. Commercial pricing, quotas and billing are not available or approved.', 'معاينة لتصميم الباقات. الأسعار والحصص والفوترة التجارية غير متاحة أو معتمدة.'],
  'pl.monthly': ['Monthly concept', 'تصور شهري'], 'pl.yearly': ['Yearly concept', 'تصور سنوي'],
  'bs.p': ['A look at what branded curriculum books could become. Books and waitlist registration are not available yet.', 'لمحة عما يمكن أن تصبح عليه كتب المناهج بهويتك. الكتب والتسجيل في قائمة الانتظار غير متاحين بعد.'],
  'band.p': ['Start with your account and a space for your teaching. Your classroom grows from here.', 'ابدأ بحسابك ومساحتك التعليمية. من هنا ينمو فصلك الدراسي.'],
  'faq.q1': ['What can I do today?', 'ماذا يمكنني أن أفعل الآن؟'], 'faq.a1': ['Create an account and an organization, create courses, edit descriptions, and manage publication and visibility. Access depends on your permissions.', 'أنشئ حسابًا ومؤسسة ومقررات وعدّل الأوصاف وأدر النشر والظهور. الوصول يعتمد على صلاحياتك.'],
  'faq.q2': ['Can anyone see my private courses?', 'هل يستطيع أي شخص رؤية مقرراتي الخاصة؟'], 'faq.a2': ['No. Organization roles, course staff and offering enrollments determine access. Permissions are enforced by the database.', 'لا. تحدد أدوار المؤسسة وفريق المقرر والالتحاق بالمجموعة صلاحيات الوصول التي تفرضها قاعدة البيانات.'],
  'faq.q3': ['Are these real teacher websites?', 'هل هذه مواقع فعلية لمعلمين؟'], 'faq.a3': ['The previews on this page are design illustrations, not customer endorsements or active websites.', 'المعاينات في هذه الصفحة تصاميم توضيحية وليست توصيات عملاء أو مواقع نشطة.'],
  'faq.a4': ['Books are a coming-soon concept. There is no active waitlist or purchasing flow.', 'الكتب فكرة قادمة. لا توجد قائمة انتظار أو عملية شراء متاحة حاليًا.'],
};
export function Marketing() {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [billing, setBilling] = useState('monthly');
  const trigger = useRef<HTMLButtonElement>(null);
  const copy = (key: string) => honest[key]?.[locale === 'ar' ? 1 : 0] ?? String((locale === 'ar' ? ar : en)[key] ?? key);
  const soon = locale === 'ar' ? 'قريبًا' : 'Coming soon';
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    const resize = () => { if (window.innerWidth >= 900) setOpen(false); };
    document.addEventListener('keydown', close); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('keydown', close); window.removeEventListener('resize', resize); };
  }, []);
  const signup = <Link className="btn btn-green" href="/sign-up">{copy('getLms')}</Link>;
  return <div className="edu-marketing edu-motion">
    <Splash />
    <button type="button" className={`scrim ${open ? 'on' : ''}`} aria-label={locale === 'ar' ? 'إغلاق القائمة' : 'Close menu'} onClick={() => setOpen(false)} tabIndex={open ? 0 : -1} />
    <header className={`site-head ${open ? 'open' : ''}`}><div className="wrap bar"><Link className="brand" href="/design-preview" aria-label="EduLabs"><Brand /></Link>
      <button ref={trigger} className="menu-btn" type="button" aria-expanded={open} aria-controls="edu-menu" aria-label={copy('menu')} onClick={() => setOpen(v => !v)}><i /><i /><i /></button>
      <div className="panel" id="edu-menu"><nav aria-label={locale === 'ar' ? 'التنقل الرئيسي' : 'Main navigation'}>{['services', 'teachers', 'plans', 'books'].map((id, i) => <a className="item" style={{ '--n': i } as CSSProperties} key={id} href={`#${id}`} onClick={() => setOpen(false)}>{copy(`nav.${id}`)}{id === 'books' && <> <span className="pill">{soon}</span></>}</a>)}</nav><div className="actions item"><Link className="btn btn-sm" href="/sign-in">{copy('login')}</Link></div><PreferenceControls /></div>
    </div><ScrollProgress /></header>
    <main>
      <section className="hero wrap"><div className="hero-copy"><Reveal kind="split"><h1>{copy('hero.h1').split(/\s+/).map((w, i) => <span key={i}><span className="w"><span className="wi" style={{ '--i': i } as CSSProperties}>{w}</span></span>{' '}</span>)}</h1></Reveal><Reveal><p className="lead">{copy('hero.lead')}</p></Reveal><Reveal><div className="cta-row">{signup}<a className="btn" href="#teachers">{copy('hero.cta2')}</a></div></Reveal></div><Reveal kind="pop" className="hero-art"><div><Tree grow /></div></Reveal></section>
      <section className="section" id="services"><div className="wrap"><SplitHeading>{copy('svc.h2')}</SplitHeading><Reveal><p className="intro-p">{copy('svc.intro')}</p></Reveal><div className="svc"><Reveal kind="side" className="tile on-green svc-lms"><h3>{copy('lms.h3')}</h3><p>{copy('lms.p')}</p><ul className="ticks">{[1,2,3,4,5].map(i => <li key={i}>{copy(`lms.t${i}`)}</li>)}</ul><div className="mt-6">{signup}</div></Reveal><Reveal className="tile svc-custom"><h3>{copy('custom.h3')}</h3><p>{copy('custom.p')}</p></Reveal><Reveal className="tile soon svc-books"><h3>{copy('bk.h3')} <span className="pill">{soon}</span></h3><p>{copy('bk.p')}</p><p><a href="#books"><strong>{copy('bk.link')}</strong></a></p></Reveal></div></div></section>
      <section className="section edu-no-top" id="how"><div className="wrap"><SplitHeading>{copy('how.h2')}</SplitHeading><ol className="steps" data-s="in">{[1,2,3,4].map((i) => <li key={i}><Reveal kind="pop" delay={(i-1)*90}><span className="num">{i}</span><h3 className="mt-3">{copy(`how.s${i}`)}</h3><p className="mt-2">{copy(`how.p${i}`)}</p></Reveal></li>)}</ol></div></section>
      <section className="section" id="teachers"><div className="wrap"><SplitHeading>{copy('tch.h2')}</SplitHeading><Reveal><p className="intro-p">{copy('tch.intro')}</p></Reveal><div className="sites">{['Biology','Mathematics','Chemistry'].map((name,i) => <Reveal className="site" kind="pop" delay={i*90} key={name}><div className="mock-bar"><i/><i/><i/><span>{locale === 'ar' ? 'معاينة تصميم' : 'Design preview'}</span></div><div className="mock-body" aria-hidden="true" style={{ '--c': ['#1f7a5a','#6c4a9e','#216c91'][i], '--c2':['#87cc9a','#c0a9df','#87c8dd'][i] } as CSSProperties}><div className="mock-hero"><b/><em/></div><div className="mock-tiles"><i/><i/><i/></div></div><div className="site-info"><strong>{locale === 'ar' ? ['الأحياء','الرياضيات','الكيمياء'][i] : name}</strong><span>{locale === 'ar' ? 'تصور توضيحي • ليس موقعًا نشطًا' : 'Illustrative concept • not a live site'}</span></div></Reveal>)}<Reveal className="site join"><h3>{copy('tch.joinH')}</h3><p>{copy('tch.joinP')}</p>{signup}</Reveal></div></div></section>
      <section className="section edu-no-top" id="plans"><div className="wrap"><SplitHeading>{copy('pl.h2')}</SplitHeading><Reveal><p className="intro-p">{copy('pl.intro')}</p></Reveal><div className="seg" data-b={billing} role="group" aria-label={copy('pl.billing')}>{['monthly','yearly'].map(value => <button type="button" key={value} data-billing={value} aria-pressed={billing === value} onClick={() => setBilling(value)}>{copy(`pl.${value}`)}</button>)}</div><div className="plans">{['seed','branch','grove'].map((name,i) => <Reveal key={name} kind="pop" delay={i*90} className={`plan ${i===1?'featured on-green':''}`}><span className="pill">{locale === 'ar' ? 'تصور فقط' : 'Concept only'}</span><h3>{copy(`plan.${name}`)}</h3><p className="blurb">{copy(`plan.${name}.b`)}</p><div className="price" key={billing}><span className="amt swap">—</span></div><p className="bill">{locale === 'ar' ? 'الأسعار لم تُعلن بعد' : 'Pricing to be announced'}</p><ul><li>{locale === 'ar' ? 'تصميم توضيحي للباقات' : 'Illustrative plan design'}</li><li>{locale === 'ar' ? 'الحصص والفوترة غير مفعّلة' : 'Quotas and billing are not active'}</li></ul><span className="btn" aria-disabled="true">{soon}</span></Reveal>)}</div><div className="extras">{[1,2].map(i => <Reveal className="extra" key={i}><h3>{copy(`ex.h${i}`)} <span className="pill">{soon}</span></h3><p>{locale === 'ar' ? 'تفاصيل الخدمة وتوفرها سيُعلنان لاحقًا.' : 'Service details and availability will be announced later.'}</p></Reveal>)}</div></div></section>
      <section className="section edu-no-top" id="books"><div className="wrap"><Reveal className="books"><div><span className="pill">{soon}</span><h2>{copy('bs.h2')}</h2><p>{copy('bs.p')}</p></div><Reveal kind="covers" className="covers"><div className="cover c1"><small>EduLabs · {locale === 'ar' ? 'تصور' : 'Concept'}</small><b>{locale === 'ar' ? 'الأحياء' : 'Biology'}</b><i>B</i></div><div className="cover c2"><small>EduLabs · {locale === 'ar' ? 'تصور' : 'Concept'}</small><b>{locale === 'ar' ? 'الرياضيات' : 'Mathematics'}</b><i>M</i></div><p className="cover-note">{locale === 'ar' ? 'كتب بهوية فصلك الدراسي.' : 'Your classroom, on the cover.'}</p></Reveal></Reveal></div></section>
      <section className="section edu-no-top" id="faq"><div className="wrap"><SplitHeading>{copy('faq.h2')}</SplitHeading><div className="faq">{[1,2,3,4].map(i => <details key={i}><summary>{copy(`faq.q${i}`)}</summary><p>{copy(`faq.a${i}`)}</p></details>)}</div></div></section>
      <section className="section edu-no-top"><div className="wrap"><Reveal kind="pop" className="band on-green"><h2>{copy('band.h2')}</h2><p>{copy('band.p')}</p>{signup}</Reveal></div></section>
    </main><footer className="foot"><div className="wrap"><Brand /><nav><a href="#services">{copy('nav.services')}</a><a href="#faq">{copy('foot.faq')}</a><Link href="/sign-in">{copy('login')}</Link></nav><small>{locale === 'ar' ? 'معاينة تصميم EduLabs. الخدمات التجارية والكتب قيد التطوير.' : 'EduLabs design preview. Commercial services and books are in development.'}</small></div></footer>
  </div>;
}
