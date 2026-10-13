import "server-only";

import { ActionError } from "@/lib/action-error";
import {
  authenticateWithPassword,
  type VerifyPasswordSignInParams,
} from "@/lib/account/password-auth";
import { normalizeEmail } from "@/lib/validation";
import { hashToken } from "@/utils/random-token";
import { RATE_LIMITS, withRateLimit } from "@/utils/with-rate-limit";

// The web sign-in entry point: rate limiting + error mapping around the shared password core
// (now in `@/lib/account/password-auth`, also reused by the mobile REST API).

async function authenticateWithErrorMapping(
  params: VerifyPasswordSignInParams,
): Promise<ReturnType<typeof authenticateWithPassword>> {
  try {
    return await authenticateWithPassword(params);
  } catch (error) {
    // Expected auth failures (e.g. wrong password) are ActionErrors; only log the unexpected ones.
    if (error instanceof ActionError) {
      throw error;
    }

    console.error(error);

    throw new ActionError("INTERNAL_SERVER_ERROR", {
      key: "Client.Errors.unexpected",
    });
  }
}

export async function signInWithPassword({
  email,
  password,
}: VerifyPasswordSignInParams): Promise<ReturnType<typeof authenticateWithPassword>> {
  // Normalize once at the action boundary so the DB lookup, the account rate-limit key, and any
  // downstream logic all key off the same canonical identity. Previously the lookup used the raw
  // input while the rate-limit bucket used a separately lowercased copy — an identity split that
  // let differently cased spellings of one account sidestep the per-account throttle.
  const canonicalEmail = normalizeEmail(email);
  const accountIdentifier = `account:${await hashToken(canonicalEmail)}`;

  return withRateLimit(
    () => withRateLimit(
      () => authenticateWithErrorMapping({ email: canonicalEmail, password }),
      {
        ...RATE_LIMITS.SIGN_IN_ACCOUNT,
        userIdentifier: accountIdentifier,
        // Only failed attempts should consume the account bucket, so a legitimate user
        // can't lock themselves out and an attacker can't lock out a victim's account.
        resetOnSuccess: true,
      },
    ),
    RATE_LIMITS.SIGN_IN,
  );
}
