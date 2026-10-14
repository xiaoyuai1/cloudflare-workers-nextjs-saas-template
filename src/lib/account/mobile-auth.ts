import "server-only";

import { eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import { EMAIL_VERIFICATION_REQUIRED } from "@/constants";
import { assertEmailNotBlocked } from "@/lib/auth/blocked-email-guard";
import { assertNotBanned, isBanned } from "@/lib/account/ban";
import { verifyPasswordSignIn } from "@/lib/account/password-auth";
import { getDB } from "@/db";
import { authIdentityTable, teamMembershipTable, teamTable, userTable } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/utils/password-hasher";
import { createMsessionToken, revokeMsessionByUser, revokeMsessionByDevice, verifyMsessionToken } from "@/utils/msession";
import { hashToken } from "@/utils/random-token";
import { normalizeEmail } from "@/lib/validation";
import { sendUserVerificationEmail } from "@/utils/email-verification";
import { withRateLimit, RATE_LIMITS } from "@/utils/with-rate-limit";
import type { MobileProfile } from "@/schemas/api/mobile-auth.schema";

// Mobile-app account service (AutoJs6 account module). Password verification goes through
// `verifyPasswordSignIn` (the same lookup/ban/passkey semantics the web form gets); this file
// adds only what the mobile contract needs on top — msession issuance, the profile projection,
// and the email-identity row.
//
// design reference: sub2api (Wei-Shaw/sub2api, LGPL-3.0) docs/PAYMENT.md — account/binding model.

export interface MobileAuthResult {
  token: string;
  profile: MobileProfile;
}

const NICKNAME_MAX_LENGTH = 64;

function accountNameOf(user: {
  email: string | null;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
}): string {
  return (
    user.nickname ||
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email?.split("@")[0] ||
    "user"
  );
}

/**
 * The mobile profile projection: AutoJsPro semantics names on top of the template's user + the
 * user's personal team. `dateExpired` is membership expiry; P1 has no granting path yet, so it
 * reads null unless a team already carries a Stripe renewal — P2 grants write this same field.
 */
export function toMobileProfile({
  user,
  personalTeamPlanExpiresAt,
}: {
  user: {
    email: string | null;
    nickname: string | null;
    firstName: string | null;
    lastName: string | null;
    avatar: string | null;
    emailVerified: Date | null;
  };
  personalTeamPlanExpiresAt: Date | null;
}): MobileProfile {
  return {
    accountName: accountNameOf(user),
    email: user.email,
    nickname: user.nickname,
    avatar: user.avatar,
    dateExpired: personalTeamPlanExpiresAt ? personalTeamPlanExpiresAt.toISOString() : null,
    // While the verification gate is off (EMAIL_VERIFICATION_REQUIRED=false), the mobile app
    // treats every account as verified: the badge would nag about a flow that cannot complete.
    emailVerified: EMAIL_VERIFICATION_REQUIRED || user.emailVerified !== null,
  };
}

/** The user's personal team = the one whose owner membership they hold. Null is legacy-tolerant. */
export async function getPersonalTeamPlanExpiresAt(userId: string): Promise<Date | null> {
  const team = await getDB()
    .select({ planExpiresAt: teamTable.planExpiresAt })
    .from(teamTable)
    .innerJoin(teamMembershipTable, eq(teamMembershipTable.teamId, teamTable.id))
    .where(eq(teamMembershipTable.userId, userId))
    .limit(50);

  // The owned team wins; a member-of-someone-else's team never sets the membership date.
  const owned = team.length === 1 ? team[0] : null;

  return owned?.planExpiresAt ?? null;
}

async function loadMobileUser(userId: string) {
  const user = await getDB().query.userTable.findFirst({
    where: { id: userId },
    columns: {
      id: true,
      email: true,
      nickname: true,
      firstName: true,
      lastName: true,
      avatar: true,
      emailVerified: true,
      bannedAt: true,
    },
  });

  if (!user) {
    throw new ActionError("NOT_FOUND", { key: "Client.Errors.userNotFound" });
  }

  return user;
}

async function buildMobileAuthResult({
  userId,
  deviceId,
}: {
  userId: string;
  deviceId: string;
}): Promise<MobileAuthResult> {
  const user = await loadMobileUser(userId);

  if (isBanned(user)) {
    throw new ActionError("FORBIDDEN", { key: "Client.Auth.SignIn.errorAccountSuspended" });
  }

  const token = await createMsessionToken({ userId, deviceId });
  const personalTeamPlanExpiresAt = await getPersonalTeamPlanExpiresAt(userId);

  return {
    token,
    profile: toMobileProfile({ user, personalTeamPlanExpiresAt }),
  };
}

/** Mobile registration: same blocklist/duplication rules as web sign-up, then an msession. */
export async function mobileRegister({
  email,
  password,
  nickname,
  signUpIpAddress,
}: {
  email: string;
  password: string;
  nickname?: string;
  signUpIpAddress: string | null;
}): Promise<MobileAuthResult> {
  const canonicalEmail = normalizeEmail(email);

  return withRateLimit(
    async (): Promise<MobileAuthResult> => {
      const db = getDB();

      await assertEmailNotBlocked({ email: canonicalEmail });

      const existingUser = await db.query.userTable.findFirst({
        where: { email: canonicalEmail },
      });

      if (existingUser) {
        throw new ActionError("CONFLICT", { key: "Client.Auth.SignUp.errorEmailTaken" });
      }

      const hashedPassword = await hashPassword({ password });

      const [user] = await db.insert(userTable)
        .values({
          email: canonicalEmail,
          nickname: nickname ? nickname.slice(0, NICKNAME_MAX_LENGTH) : null,
          passwordHash: hashedPassword,
          signUpIpAddress,
        })
        .returning();

      if (!user || !user.email) {
        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Auth.Common.errorCreateUser" });
      }

      try {
        const result = await buildMobileAuthResult({ userId: user.id, deviceId: "registration" });

        // Verification mail only while the gate is on; the off state bypasses the whole flow
        // (user decision: run the basic account loop first, mail verification comes later).
        if (EMAIL_VERIFICATION_REQUIRED && user.email) {
          await sendUserVerificationEmail({
            userId: user.id,
            email: user.email,
            username: nickname || user.email,
          });
        }

        return result;
      } catch (error) {
        console.error(error);

        throw new ActionError("INTERNAL_SERVER_ERROR", { key: "Client.Auth.SignUp.errorCreateSession" });
      }
    },
    // The route hands in the trusted client IP: `chargeBucket` falls back to Next's `headers()`
    // when no userIdentifier is set, and that API does not exist on the plain Hono dispatch.
    signUpIpAddress
      ? { ...RATE_LIMITS.SIGN_UP, userIdentifier: `ip:${signUpIpAddress}` }
      : RATE_LIMITS.SIGN_UP,
  );
}

/** Mobile login: shared password core, then an msession bound to the caller's deviceId. */
export async function mobileLogin({
  email,
  password,
  deviceId,
  clientIp,
}: {
  email: string;
  password: string;
  deviceId: string;
  /** Trusted client IP from the API layer; the outer IP bucket needs it because Next's
   * `headers()` does not exist on the plain Hono dispatch this service serves. */
  clientIp: string | null;
}): Promise<MobileAuthResult> {
  const canonicalEmail = normalizeEmail(email);
  const accountIdentifier = `account:${await hashToken(canonicalEmail)}`;

  return withRateLimit(
    () => withRateLimit(
      async (): Promise<MobileAuthResult> => {
        const { userId } = await verifyPasswordSignIn({
          email: canonicalEmail,
          password,
        });

        return buildMobileAuthResult({ userId, deviceId });
      },
      {
        ...RATE_LIMITS.SIGN_IN_ACCOUNT,
        userIdentifier: accountIdentifier,
        resetOnSuccess: true,
      },
    ),
    clientIp
      ? { ...RATE_LIMITS.SIGN_IN, userIdentifier: `ip:${clientIp}` }
      : RATE_LIMITS.SIGN_IN,
  );
}

/** Change password: verify the old one, CAS-write the new hash, revoke every msession. */
export async function mobileChangePassword({
  userId,
  oldPassword,
  newPassword,
}: {
  userId: string;
  oldPassword: string;
  newPassword: string;
}): Promise<void> {
  const db = getDB();
  const user = await db.query.userTable.findFirst({
    where: { id: userId },
    columns: { id: true, passwordHash: true, bannedAt: true },
  });

  if (!user) {
    throw new ActionError("NOT_FOUND", { key: "Client.Errors.userNotFound" });
  }

  assertNotBanned(user);

  if (!user.passwordHash) {
    throw new ActionError("FORBIDDEN", { key: "Client.Auth.SignIn.errorUseGoogle" });
  }

  const verification = await verifyPassword({
    storedHash: user.passwordHash,
    passwordAttempt: oldPassword,
  });

  if (!verification.isValid) {
    throw new ActionError("NOT_AUTHORIZED", { key: "Client.Auth.SignIn.errorInvalidCredentials" });
  }

  const passwordHash = await hashPassword({ password: newPassword });
  await db.update(userTable).set({ passwordHash }).where(eq(userTable.id, userId));

  // Every msession dies with the old credential; the app re-signs in with the new password.
  await revokeMsessionByUser(userId);
}

/** Logout the calling device: delete this request's msession record. */
export async function mobileLogout({
  authorization,
}: {
  authorization: string | null;
}): Promise<void> {
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : null;

  if (!token) {
    return;
  }

  const record = await verifyMsessionToken(token);

  if (record) {
    await revokeMsessionByDevice({ userId: record.userId, deviceId: record.deviceId });
  }
}

/** Write the email identity row (P1: registration-time). P1.5 adds OAuth providers here. */
export async function linkEmailIdentity({
  userId,
  email,
  verifiedAt,
}: {
  userId: string;
  email: string;
  verifiedAt: Date | null;
}): Promise<void> {
  await getDB().insert(authIdentityTable).values({
    userId,
    providerType: "email",
    providerKey: "",
    providerSubject: normalizeEmail(email),
    verifiedAt,
  }).onConflictDoNothing();
}
