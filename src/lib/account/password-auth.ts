import "server-only";

import { and, eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import { assertNotBanned } from "@/lib/account/ban";
import { getDB } from "@/db";
import { userTable } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/utils/password-hasher";
import { createSessionUnlessBanned, type SignInSuccess } from "@/utils/auth";

// The password-verification core shared by the web sign-in form and the mobile REST API
// (AutoJs6 account module): lookup, Google/passkey guard, verify + rehash, ban checks, and the
// session write. Callers layer their own rate limits and session surface (cookie vs msession)
// on top, so both entry points get identical lockout and ban semantics by construction.

export interface VerifyPasswordSignInParams {
  email: string;
  password: string;
}

type Database = ReturnType<typeof getDB>;

interface PasswordSignInUser {
  googleAccountId: string | null;
  id: string;
  passwordHash: string | null;
  bannedAt: Date | null;
}

function invalidCredentialsError(): ActionError {
  return new ActionError("NOT_AUTHORIZED", {
    key: "Client.Auth.SignIn.errorInvalidCredentials",
  });
}

async function getPasswordSignInUser({
  db,
  email,
}: {
  db: Database;
  email: string;
}): Promise<PasswordSignInUser & { passwordHash: string }> {
  // `email` is already canonicalized (trimmed + lowercased) at the action boundary. Sign-up
  // historically persisted the raw input, so legacy rows may hold mixed-case addresses; a plain
  // equality match on the lowercased value would miss them. Compare case-insensitively via
  // lower(email) so both legacy mixed-case rows and normalized rows resolve to one account.
  // Tradeoff: lower() forgoes a plain index on email, but this runs once per sign-in attempt.
  const user = await db.query.userTable.findFirst({
    where: {
      RAW: (table, { sql }) => sql`lower(${table.email}) = ${email}`,
    },
    columns: {
      googleAccountId: true,
      id: true,
      passwordHash: true,
      bannedAt: true,
    },
  });

  if (!user) {
    throw invalidCredentialsError();
  }

  if (!user.passwordHash && user.googleAccountId) {
    throw new ActionError("FORBIDDEN", {
      key: "Client.Auth.SignIn.errorUseGoogle",
    });
  }

  if (!user.passwordHash) {
    throw invalidCredentialsError();
  }

  return {
    ...user,
    passwordHash: user.passwordHash,
  };
}

async function verifySignInPassword({
  password,
  storedHash,
}: {
  password: string;
  storedHash: string;
}): Promise<{ needsRehash: boolean }> {
  const verification = await verifyPassword({
    storedHash,
    passwordAttempt: password,
  });

  if (!verification.isValid) {
    throw invalidCredentialsError();
  }

  return { needsRehash: verification.needsRehash };
}

async function requirePasswordSignIn({
  db,
  userId,
}: {
  db: Database;
  userId: string;
}): Promise<void> {
  const passkey = await db.query.passKeyCredentialTable.findFirst({
    where: { userId },
    columns: {
      id: true,
    },
  });

  if (passkey) {
    throw new ActionError("FORBIDDEN", {
      key: "Client.Auth.SignIn.errorUsePasskey",
    });
  }
}

async function upgradePasswordHash({
  db,
  password,
  storedHash,
  userId,
}: {
  db: Database;
  password: string;
  storedHash: string;
  userId: string;
}): Promise<void> {
  try {
    const passwordHash = await hashPassword({ password });
    await db
      .update(userTable)
      .set({ passwordHash })
      .where(and(
        eq(userTable.id, userId),
        eq(userTable.passwordHash, storedHash),
      ));
  } catch (error) {
    // A hashing-policy migration should not lock out a user with valid credentials.
    console.error("Failed to upgrade password hash after sign-in", error);
  }
}

/**
 * Verify the credentials and, on success, write the web KV session. Throws the shared
 * ActionErrors (invalid credentials / use Google / use passkey / account suspended).
 */
export async function authenticateWithPassword({
  email,
  password,
}: VerifyPasswordSignInParams): Promise<SignInSuccess> {
  const db = getDB();
  const user = await getPasswordSignInUser({ db, email });
  const { needsRehash } = await verifySignInPassword({
    password,
    storedHash: user.passwordHash,
  });

  // After the password verifies, never before: checking first would tell an anonymous caller
  // which addresses are banned. By here they have already proved they know the credential.
  assertNotBanned(user);

  await requirePasswordSignIn({ db, userId: user.id });

  if (needsRehash) {
    await upgradePasswordHash({
      db,
      password,
      storedHash: user.passwordHash,
      userId: user.id,
    });
  }

  // Re-checks the ban after it writes the session, so a ban landing since the check above cannot
  // leave a live session behind.
  const { preferredLocale } = await createSessionUnlessBanned({
    userId: user.id,
    authenticationType: "password",
  });

  return { success: true, preferredLocale };
}

/** Verify the credentials without writing any session — the mobile API mints its own msession. */
export async function verifyPasswordSignIn({
  email,
  password,
}: VerifyPasswordSignInParams): Promise<{ userId: string }> {
  const db = getDB();
  const user = await getPasswordSignInUser({ db, email });
  await verifySignInPassword({ password, storedHash: user.passwordHash });

  assertNotBanned(user);
  await requirePasswordSignIn({ db, userId: user.id });

  return { userId: user.id };
}
