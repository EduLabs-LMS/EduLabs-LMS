'use client';
import { useCallback,useEffect,useRef,useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { GoogleAuthProvider,OAuthProvider,sendEmailVerification,signInWithEmailAndPassword,signInWithPopup,signInWithRedirect,getRedirectResult,getAdditionalUserInfo } from 'firebase/auth';
import { Eye,EyeOff,ArrowRight,ShieldCheck } from 'lucide-react';
import { getFirebaseAuth,restoreFirebaseAuth } from '@/frontend/lib/firebase';
import { synchronizeFirebaseSession,useFirebaseAuth } from '@/frontend/components/providers/firebase-auth-provider';
import { useGlobalLoading } from '@/frontend/components/providers/loading-provider';
import { safeStudentAuthDestination } from '@/shared/contracts/student-administration';
import { accountNames } from '@/shared/contracts/account';
import { hasPendingInvitation } from '@/frontend/lib/teacher-invitation-storage';
import { invitationPagePath } from '@/shared/invitation-link';
import { registerFirebaseAccount } from '@/frontend/lib/signup-recovery';
import { storeAccountDraft } from '@/frontend/lib/account-draft';
import EduLabsMark from '@/frontend/components/edulabs-mark';
import { useLanguage } from '@/frontend/components/language-provider';
import { Button } from '@/frontend/components/design/button';
import { Field } from '@/frontend/components/design/field';
import { AvatarPicker } from './avatar-picker';
import { GoogleIcon,AppleIcon } from './provider-icons';

export function readableAuthError(failure:unknown){if(Array.isArray((failure as {issues?:unknown})?.issues))return 'Enter valid first and last names.';const code=(failure as {code?:string})?.code;const messages:Record<string,string>={
 'auth/invalid-credential':'Email or password is incorrect.','auth/email-already-in-use':'This email already has an account. Sign in or reset your password.','auth/weak-password':'Choose a stronger password with at least 12 characters.','auth/too-many-requests':'Too many attempts. Please wait before trying again.','auth/unauthorized-domain':'This website domain needs to be authorized in Firebase.','auth/popup-closed-by-user':'Sign-in was cancelled.','auth/operation-not-allowed':'This sign-in method is not enabled. Use an available method.','auth/requires-recent-login':'Please verify your current sign-in again before changing this setting.','auth/wrong-password':'The current password is incorrect.','auth/invalid-email':'Enter a valid email address.','auth/network-request-failed':'Check your connection and retry.','auth/account-exists-with-different-credential':'Sign in using the method already linked to this account. Accounts are never linked automatically by email.'};return (code&&messages[code])||(failure instanceof Error&&!code?failure.message:'Unable to complete this request. Please try again.');}
async function rememberProviderProfile(credential:import('firebase/auth').UserCredential){
 const info=getAdditionalUserInfo(credential);if(!info?.isNewUser)return;
 const supplied=info.profile??{},parts=(credential.user.displayName??'').trim().split(/\s+/);
 const appleName=supplied.name&&typeof supplied.name==='object'?supplied.name as Record<string,unknown>:{};
 const first=typeof supplied.given_name==='string'?supplied.given_name:typeof appleName.firstName==='string'?appleName.firstName:parts[0]??'',last=typeof supplied.family_name==='string'?supplied.family_name:typeof appleName.lastName==='string'?appleName.lastName:parts.slice(1).join(' ');
 // Provider-supplied names are editable presentation only, never authorization.
 try{await storeAccountDraft(credential.user.uid,first.slice(0,60),last.slice(0,60),null,'provider');}catch{/* Manual onboarding remains available. */}
}
// The student contract only knows student destinations. A teacher with a stored invitation is sent back to the invitation page, never anywhere else.
function authDestination(raw:string|null){if(raw===invitationPagePath)return invitationPagePath;const destination=safeStudentAuthDestination(raw);return destination==='/home'&&hasPendingInvitation()?invitationPagePath:destination;}
function readRememberedNext(){try{return sessionStorage.getItem('edulabs-auth-next');}catch{return null;}}
export function FirebaseForm({register=false}:{register?:boolean}){
 const router=useRouter();const {t}=useLanguage();
 const {beginFirstLoad}=useGlobalLoading();
 const {user,loading,error,refresh}=useFirebaseAuth();
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[firstName,setFirstName]=useState(''),[lastName,setLastName]=useState(''),[photo,setPhoto]=useState<File|null>(null),[show,setShow]=useState(false),[next,setNext]=useState('/home'),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null),[retryAt,setRetryAt]=useState(0),[now,setNow]=useState(0);
 const [redirectReady,setRedirectReady]=useState(false);
 const redirecting=useRef(false),operation=useRef(false);const apple=process.env.NEXT_PUBLIC_FIREBASE_APPLE_ENABLED==='true';
 useEffect(()=>{setNext(authDestination(new URLSearchParams(window.location.search).get('next')||readRememberedNext()));const tick=()=>setNow(Date.now());tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);},[]);
 // `fresh` is true when the person has just signed in here: the logo overlay then plays once over the first page. A session restored on arrival goes straight home.
 const goHome=useCallback((fresh=false)=>{if(redirecting.current)return;redirecting.current=true;const destination=authDestination(new URLSearchParams(window.location.search).get('next')||readRememberedNext());try{sessionStorage.removeItem('edulabs-auth-next');}catch{}if(fresh)beginFirstLoad();router.replace(destination);},[router,beginFirstLoad]);
 const run=async(fn:()=>Promise<void>)=>{if(operation.current)return;operation.current=true;setBusy(true);setMessage(null);try{await restoreFirebaseAuth();await fn();}catch(e){setMessage(readableAuthError(e));}finally{operation.current=false;setBusy(false);}};
 useEffect(()=>{let active=true;void restoreFirebaseAuth().then(()=>getRedirectResult(getFirebaseAuth())).then(async value=>{if(value){beginFirstLoad();await rememberProviderProfile(value);}}).catch(e=>{if(active)setMessage(readableAuthError(e));}).finally(()=>{if(active)setRedirectReady(true);});return()=>{active=false;};},[beginFirstLoad]);
 useEffect(()=>{if(user?.emailVerified&&!loading&&!error&&!busy&&redirectReady)goHome();},[user,loading,error,busy,redirectReady,goHome]);
 const submit=()=>run(async()=>{
  if(register){accountNames.parse({firstName,lastName});if(password!==confirm)throw Error('Passwords must match.');if(password.length<12)throw Error('Use at least 12 characters.');if(Date.now()<retryAt)throw Error('Your account is saved. Wait before retrying verification.');
   const result=await registerFirebaseAccount(getFirebaseAuth(),email,password,`${firstName.trim()} ${lastName.trim()}`);setRetryAt(Date.now()+result.retryAfterSeconds*1000);setMessage(result.message);
   try{await storeAccountDraft(result.user.uid,firstName.trim(),lastName.trim(),photo);}catch{setMessage(result.message+' Your profile draft could not be saved on this device. Finish it from your account after verification.');}
   if(result.user.emailVerified){await synchronizeFirebaseSession(result.user);goHome(true);}
  }else{const credential=await signInWithEmailAndPassword(getFirebaseAuth(),email.trim(),password);if(!credential.user.emailVerified){setMessage('Your account is saved. Verify your email, then choose “I verified my email”.');return;}await synchronizeFirebaseSession(credential.user);goHome(true);}
 });
 const provider=(kind:'google'|'apple')=>run(async()=>{if(kind==='apple'&&!apple)throw Error('Apple sign-in is not configured yet.');try{sessionStorage.setItem('edulabs-auth-next',next);}catch{}const value=kind==='google'?new GoogleAuthProvider():new OAuthProvider('apple.com');if(value instanceof OAuthProvider){value.addScope('email');value.addScope('name');}try{const credential=await signInWithPopup(getFirebaseAuth(),value);await rememberProviderProfile(credential);await synchronizeFirebaseSession(credential.user);goHome(true);}catch(e){if(['auth/popup-blocked','auth/operation-not-supported-in-this-environment'].includes((e as {code:string}).code))await signInWithRedirect(getFirebaseAuth(),value);else throw e;}});
 return <section data-auth-surface className="d-card d-auth">
  <div className="d-auth-aside"><div className="d-auth-brand"><EduLabsMark grow lightShadowOnly className="h-12 w-12"/><span className="d-auth-word">EduLabs</span></div><div className="d-auth-pitch"><EduLabsMark lightShadowOnly grow className="mx-auto h-48 w-48"/><h2 className="d-auth-pitch-title">Your next chapter starts here.</h2><p className="d-auth-copy">One learning account. Your teachers, courses and progress, together.</p></div><p className="d-auth-note"><ShieldCheck className="h-4 w-4 shrink-0"/>Creating an account never grants access to private courses.</p></div>
  <div className="d-auth-main"><header className="d-auth-head"><h1 className="d-title">{register?'Create your account':'Welcome back'}</h1><p className="d-auth-sub">{register?'Set up your profile and verify your email.':'Sign in to keep learning.'}</p></header>
   <form onSubmit={e=>{e.preventDefault();void submit();}} className="d-auth-form"><fieldset disabled={busy||loading} className="d-auth-fields">
    {register&&<><AvatarPicker design file={photo} onChange={setPhoto}/><div className="d-auth-names"><Field label="First name" required maxLength={60} autoComplete="given-name" value={firstName} onChange={e=>setFirstName(e.target.value)}/><Field label="Last name" required maxLength={60} autoComplete="family-name" value={lastName} onChange={e=>setLastName(e.target.value)}/></div><p className="d-field-hint">Your photo stays on this device until verification and is uploaded privately afterward.</p></>}
    <Field label="Email" required type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/>
    <Field label="Password" required type={show?'text':'password'} minLength={register?12:undefined} autoComplete={register?'new-password':'current-password'} value={password} onChange={e=>setPassword(e.target.value)} trailing={<button type="button" aria-label={show?'Hide password':'Show password'} aria-pressed={show} className="d-field-toggle" onClick={()=>setShow(!show)}>{show?<EyeOff className="h-5 w-5"/>:<Eye className="h-5 w-5"/>}</button>}/>
    {register&&<><Field label="Confirm password" required type={show?'text':'password'} autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} aria-invalid={!!confirm&&password!==confirm}/><p className="d-field-hint">At least 12 characters. {confirm&&(password===confirm?'Passwords match.':'Passwords do not match.')}</p></>}
    <Button type="submit" variant="primary" size="lg" block>{busy?'Please wait…':register?'Create account':'Sign in'}<ArrowRight className="d-auth-arrow h-4 w-4"/></Button>
   </fieldset></form>
   <div className="d-auth-providers"><Button block disabled={busy||loading} onClick={()=>void provider('google')}><GoogleIcon/>Continue with Google</Button><Button block disabled={!apple||busy||loading} aria-describedby={!apple?'apple-setup':undefined} onClick={()=>void provider('apple')}><AppleIcon/>Continue with Apple</Button>{!apple&&<p id="apple-setup" className="d-field-hint">Apple sign-in requires provider setup and is currently unavailable.</p>}</div>
   {!register&&<p className="d-auth-links"><Link className="d-inline-link" href="/forgot-password">{t('pr.signin_link')}</Link></p>}
   {user&&!user.emailVerified&&<div className="d-auth-verify"><p>Check your inbox and spam folder. Learning access remains locked until your email is verified.</p><div className="d-auth-links"><Button variant="tertiary" disabled={busy||now<retryAt} onClick={()=>void run(async()=>{if(Date.now()<retryAt)throw Error('Wait before requesting another verification email.');setRetryAt(Date.now()+60000);await sendEmailVerification(user);setMessage('Verification email sent. Check your inbox.');})}>{now<retryAt?`Resend in ${Math.ceil((retryAt-now)/1000)}s`:'Resend verification'}</Button><Button variant="tertiary" disabled={busy} onClick={()=>void run(async()=>{await refresh();goHome();})}>I verified my email</Button></div></div>}
   {(message||error)&&<p role="status" aria-live="polite" className="d-notice d-auth-message">{message||error}</p>}
   <p className="d-auth-links"><Link className="d-inline-link" href={(register?'/sign-in':'/sign-up')+(next==='/home'?'':'?next='+encodeURIComponent(next))}>{register?'Already have an account? Sign in':'Create an account'}</Link></p>
  </div>
 </section>;
}
