import { EmailAuthProvider,GoogleAuthProvider,OAuthProvider,reauthenticateWithCredential,reauthenticateWithPopup,verifyBeforeUpdateEmail,updatePassword,type User } from 'firebase/auth';
export function linkedAccountMethods(user:User){return Array.from(new Set(user.providerData.map(p=>p.providerId)));}
export async function reauthenticateAccount(user:User,password:string,method:string){
 if(!linkedAccountMethods(user).includes(method))throw Error('That sign-in method is not linked to your account.');
 if(method==='password'){if(!user.email||!password)throw Error('Enter your current password.');await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,password));}
 else if(method==='google.com')await reauthenticateWithPopup(user,new GoogleAuthProvider());
 else if(method==='apple.com')await reauthenticateWithPopup(user,new OAuthProvider('apple.com'));
 else throw Error('Use your linked provider to manage this account.');
}
export async function requestAccountEmailChange(user:User,email:string,password:string,method:string){
 const address=email.trim();if(!user.emailVerified)throw Error('Verify your current email before changing it.');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)||address.toLowerCase()===user.email?.toLowerCase())throw Error('Enter a different valid email address.');
 await reauthenticateAccount(user,password,method);await verifyBeforeUpdateEmail(user,address);
 // Pending email remains solely in Firebase's verification flow. Never update
 // mappings, profile ownership or enrollments from the requested email address.
}
export async function changeAccountPassword(user:User,current:string,password:string,confirmation:string){
 if(!linkedAccountMethods(user).includes('password'))throw Error('Your account uses an external sign-in provider. Manage its password with that provider.');
 if(password.length<12||password!==confirmation)throw Error('Use matching passwords with at least 12 characters.');
 await reauthenticateAccount(user,current,'password');await updatePassword(user,password);
}
