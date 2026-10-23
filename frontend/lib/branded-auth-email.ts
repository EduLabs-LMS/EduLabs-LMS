import type { User } from 'firebase/auth';

async function post(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error('Too many requests. Wait a little before trying again.');
    if (response.status === 503) throw new Error('Branded email is being configured. Please try again later.');
    throw new Error('Unable to send the email. Please try again later.');
  }
}

export async function requestBrandedVerification(user: User) {
  const idToken = await user.getIdToken();
  await post('/api/auth/branded-email/verification', { idToken });
}

export async function requestBrandedPasswordReset(email: string) {
  await post('/api/auth/branded-email/password-reset', { email: email.trim() });
}
