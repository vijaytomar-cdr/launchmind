/**
 * @file app/(auth)/login/actions.ts
 * @description Server Actions for email/password sign-in.
 *   Runs on the server so the session cookie is written into the HTTP response
 *   before any redirect — avoiding the client-side cookie timing race.
 *   On success, calls redirect('/dashboard') so Next.js flushes Set-Cookie headers
 *   into the redirect response. Returning a plain value does NOT guarantee cookies
 *   are flushed; redirect() is the only reliable trigger.
 * @security Uses server Supabase client (anon key + cookie store). No secrets exposed.
 * @dependencies lib/supabase/server, next/navigation, next/cache
 */

'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export type LoginError = { error: string };
export type LoginMfa = { needsMfa: true; factorId: string };

/**
 * Sign in with email + password server-side.
 * On success: calls redirect('/dashboard') — never returns to caller.
 * On MFA required: returns { needsMfa: true, factorId }.
 * On failure: returns { error: string }.
 */
export async function signInAction(
  formData: FormData
): Promise<LoginError | LoginMfa> {
  const supabase = createClient();

  const email = (formData.get('email') as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    return { error: signInError.message };
  }

  // Check if MFA is required
  const { data: aalData, error: aalError } =
    await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (aalError) {
    return { error: aalError.message };
  }

  if (aalData.nextLevel === 'aal2' && aalData.nextLevel !== aalData.currentLevel) {
    const { data: factorsData, error: factorsError } =
      await supabase.auth.mfa.listFactors();
    if (factorsError) {
      return { error: factorsError.message };
    }
    const totpFactor = factorsData.totp[0];
    if (totpFactor) {
      return { needsMfa: true, factorId: totpFactor.id };
    }
  }

  // No MFA — flush cookies into the redirect response and navigate.
  // revalidatePath ensures the dashboard layout re-renders with the new session.
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}
