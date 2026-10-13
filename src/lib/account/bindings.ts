import "server-only";

import { eq } from "drizzle-orm";

import { ActionError } from "@/lib/action-error";
import { getDB } from "@/db";
import { authIdentityTable, userTable } from "@/db/schema";
import { revokeMsessionByUser } from "@/utils/msession";

// External-identity binding management (AutoJs6 account module, contract table A).
//
// design reference: sub2api (Wei-Shaw/sub2api, LGPL-3.0) docs/PAYMENT.md — unbind floor check.

const UNBINDABLE_PROVIDERS = ["email", "github", "wechat", "dingtalk"] as const;
type UnbindableProvider = (typeof UNBINDABLE_PROVIDERS)[number];

function isUnbindableProvider(value: string): value is UnbindableProvider {
  return (UNBINDABLE_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Remove one identity row. The floor: after the delete the account must still hold either the
 * email identity backed by a usable password, or at least one other external identity. Refuses
 * with 409 otherwise. On success every msession is revoked — the removed credential could have
 * minted them (P1.5 OAuth sign-in), so the safe move is a global re-login, matching sub2api.
 */
export async function unbindIdentity({
  userId,
  provider,
}: {
  userId: string;
  provider: string;
}): Promise<void> {
  if (!isUnbindableProvider(provider)) {
    throw new ActionError("NOT_FOUND", { key: "Client.Errors.userNotFound" });
  }

  const db = getDB();

  const identities = await db.query.authIdentityTable.findMany({
    where: { userId },
    columns: { id: true, providerType: true },
  });

  const target = identities.find((identity) => identity.providerType === provider);

  if (!target) {
    throw new ActionError("NOT_FOUND", { key: "Client.Errors.userNotFound" });
  }

  if (provider === "email") {
    // The email identity can only go when another identity remains — a password is not an
    // external identity, so "email + password" alone is exactly the floor, not above it.
    const others = identities.filter((identity) => identity.providerType !== "email");

    if (others.length === 0) {
      throw new ActionError("CONFLICT", { key: "Client.Errors.notAuthorized" });
    }
  } else {
    // Unbinding an OAuth identity: the floor is the email identity backed by a usable password.
    const [user, emailIdentity] = await Promise.all([
      db.query.userTable.findFirst({
        where: { id: userId },
        columns: { passwordHash: true },
      }),
      db.query.authIdentityTable.findFirst({
        where: { userId, providerType: "email" },
        columns: { id: true },
      }),
    ]);

    const canStillUseEmail = !!user?.passwordHash && !!emailIdentity;

    if (!canStillUseEmail) {
      throw new ActionError("CONFLICT", { key: "Client.Errors.notAuthorized" });
    }
  }

  await db.delete(authIdentityTable).where(eq(authIdentityTable.id, target.id));

  await revokeMsessionByUser(userId);
}
