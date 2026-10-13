import "server-only";

import { Hono } from "hono";

import { apiValidator } from "@/api/middleware/problem-json";
import { apiOperation } from "@/api/operation";
import { API_TAGS } from "@/api/openapi-document";
import { jsonResponse } from "@/api/openapi";
import type { ApiEnv } from "@/api/types";
import { getDB } from "@/db";
import {
  mobileRegister,
  mobileLogin,
  mobileChangePassword,
  mobileLogout,
  linkEmailIdentity,
  getPersonalTeamPlanExpiresAt,
  toMobileProfile,
} from "@/lib/account/mobile-auth";
import { unbindIdentity } from "@/lib/account/bindings";
import { __INTERNAL_TRUSTED_CLIENT_IP_HEADER } from "@/utils/trusted-client-ip";
import { getCurrentSession } from "@/utils/auth";
import { ActionError } from "@/lib/action-error";
import {
  mobileRegisterSchema,
  mobileLoginSchema,
  mobileChangePasswordSchema,
  mobileRegisterResponseSchema,
  mobileLoginResponseSchema,
  mobileMeResponseSchema,
  mobileBindingsSchema,
  mobileUnbindParamSchema,
} from "@/schemas/api/mobile-auth.schema";
import { successSchema } from "@/schemas/api/common.schema";

// Mobile-app account REST (AutoJs6 account module), contract table A. Mounted through
// `registerCustomRoutes` (src/api/index.ts). Register/login mint an msession and are therefore
// public; me/change-password/bindings require the Bearer msession the app stores.
//
// Public endpoints declare `scope: null, audience: "any"`: the guard asserts only that a
// principal exists, which an anonymous caller trivially satisfies, and the handler is the real
// gate. This is distinct from credential introspection (`getCredential`), the only other
// unscoped operation, which the route-table audit pins separately.

/** Nickname out of an identity's metadata JSON, or null when the provider gave none. */
function safeDisplayName(metadata: string | null): string | null {
  if (!metadata) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(metadata);
    const nickname = (parsed as Record<string, unknown> | null)?.nickname;

    return typeof nickname === "string" ? nickname : null;
  } catch {
    return null;
  }
}

export const mobileAuthRoutes = new Hono<ApiEnv>()
  .post(
    "/auth/register",
    ...apiOperation({
      operationId: "mobileRegister",
      tags: [API_TAGS.account],
      summary: "Register a mobile account",
      description:
        "Creates an account from the mobile app (AutoJs6 account module): same blocklist and " +
        "duplicate rules as web sign-up, then returns an msession bearer token and the profile. " +
        "A verification email is sent when EMAIL_VERIFICATION_REQUIRED is on. Public: the caller " +
        "holds no credential yet, so no scope can be required.",
      scope: null,
      audience: "any",
      responses: {
        201: jsonResponse({
          description: "The new session token and profile.",
          schema: mobileRegisterResponseSchema,
        }),
      },
    }),
    apiValidator("json", mobileRegisterSchema),
    async (c) => {
      const input = c.req.valid("json");
      const email = input.email.trim().toLowerCase();
      const result = await mobileRegister({
        email,
        password: input.password,
        nickname: input.nickname,
        // Set by `withForwardedCfHeaders` in the entrypoint; `getIP()` reads Next's `headers()`,
        // which does not exist on the plain Hono dispatch this module serves.
        signUpIpAddress: c.req.header(__INTERNAL_TRUSTED_CLIENT_IP_HEADER) ?? null,
      });

      // The service resolved the id internally; one indexed lookup here keeps the contract
      // between route and service a plain success value.
      const user = await getDB().query.userTable.findFirst({
        where: { email },
        columns: { id: true },
      });

      if (user) {
        await linkEmailIdentity({ userId: user.id, email, verifiedAt: null });
      }

      return c.json(result, 201);
    },
  )
  .post(
    "/auth/login",
    ...apiOperation({
      operationId: "mobileLogin",
      tags: [API_TAGS.account],
      summary: "Sign in from the mobile app",
      description:
        "Verifies the password through the shared sign-in core (same lockout, ban, and rehash " +
        "semantics as the web form) and returns an msession bearer token bound to the caller's " +
        "deviceId. Public: the caller holds no credential yet.",
      scope: null,
      audience: "any",
      responses: {
        200: jsonResponse({
          description: "The session token and profile.",
          schema: mobileLoginResponseSchema,
        }),
      },
    }),
    apiValidator("json", mobileLoginSchema),
    async (c) => {
      const input = c.req.valid("json");

      return c.json(await mobileLogin({
        ...input,
        clientIp: c.req.header(__INTERNAL_TRUSTED_CLIENT_IP_HEADER) ?? null,
      }));
    },
  )
  .post(
    "/auth/logout",
    ...apiOperation({
      operationId: "mobileLogout",
      tags: [API_TAGS.account],
      summary: "Sign out the calling device",
      description:
        "Deletes the msession record behind the presented Bearer token. Idempotent: a stale or " +
        "already-revoked token still answers 200.",
      scope: null,
      audience: "any",
      responses: {
        200: jsonResponse({ description: "Signed out.", schema: successSchema }),
      },
    }),
    async (c) => {
      await mobileLogout({ authorization: c.req.header("authorization") ?? null });

      return c.json({ success: true });
    },
  )
  .get(
    "/auth/me",
    ...apiOperation({
      operationId: "mobileGetMe",
      tags: [API_TAGS.account],
      summary: "Get the mobile account profile",
      description:
        "Returns the AutoJsPro-semantics profile of the msession caller: accountName, email, " +
        "nickname, avatar, membership expiry (dateExpired), and verification state.",
      scope: "profile:read",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The profile.", schema: mobileMeResponseSchema }),
      },
    }),
    async (c) => {
      // Read-only profile: an unverified account still gets its own profile (the App shows the
      // verify prompt from `emailVerified`); write operations elsewhere keep the verified gate.
      const session = await getCurrentSession();

      if (!session) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
      }

      const personalTeamPlanExpiresAt = await getPersonalTeamPlanExpiresAt(session.user.id);

      const profile = toMobileProfile({
        user: {
          email: session.user.email,
          nickname: session.user.nickname ?? null,
          firstName: session.user.firstName ?? null,
          lastName: session.user.lastName ?? null,
          avatar: session.user.avatar ?? null,
          emailVerified: session.user.emailVerified ?? null,
        },
        personalTeamPlanExpiresAt,
      });

      return c.json({ profile });
    },
  )
  .post(
    "/auth/change-password",
    ...apiOperation({
      operationId: "mobileChangePassword",
      tags: [API_TAGS.account],
      summary: "Change the account password",
      description:
        "Verifies the old password, writes the new hash, and revokes every msession of the " +
        "account (all devices must sign in again with the new password).",
      scope: "profile:write",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "Password changed.", schema: successSchema }),
      },
    }),
    apiValidator("json", mobileChangePasswordSchema),
    async (c) => {
      // Credential management, not a content feature: the same unverified-tolerant semantics as
      // sign-in. An account that cannot sign in to its mail cannot verify either — the gate here
      // would lock it out permanently.
      const session = await getCurrentSession();

      if (!session) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
      }

      const input = c.req.valid("json");

      await mobileChangePassword({
        userId: session.user.id,
        oldPassword: input.oldPassword,
        newPassword: input.newPassword,
      });

      return c.json({ success: true });
    },
  )
  .get(
    "/auth/bindings",
    ...apiOperation({
      operationId: "mobileListBindings",
      tags: [API_TAGS.account],
      summary: "List the account's login identities",
      description:
        "Lists every external identity linked to the account (the email identity always present; " +
        "OAuth providers arrive with P1.5). The unbind floor check reads the same list.",
      scope: "profile:read",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "The linked identities.", schema: mobileBindingsSchema }),
      },
    }),
    async (c) => {
      // Read-only binding list, same unverified-tolerant semantics as /auth/me.
      const session = await getCurrentSession();

      if (!session) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
      }

      const rows = await getDB().query.authIdentityTable.findMany({
        where: { userId: session.user.id },
        columns: {
          providerType: true,
          verifiedAt: true,
          metadata: true,
          createdAt: true,
        },
      });

      return c.json(
        rows.map((row) => ({
          provider: row.providerType,
          boundAt: row.createdAt.toISOString(),
          displayName: safeDisplayName(row.metadata),
        })),
      );
    },
  )
  .delete(
    "/auth/bindings/:provider",
    ...apiOperation({
      operationId: "mobileUnbindProvider",
      tags: [API_TAGS.account],
      summary: "Unlink an external identity",
      description:
        "Removes a linked identity. Refuses with 409 when it would leave the account with no " +
        "usable login (the email identity with a usable password, or at least one other identity, " +
        "must remain). Revokes every msession on success.",
      scope: "profile:write",
      audience: "account",
      responses: {
        200: jsonResponse({ description: "Unlinked.", schema: successSchema }),
      },
    }),
    apiValidator("param", mobileUnbindParamSchema),
    async (c) => {
      // Same credential-management semantics as change-password: unbinding is not a content
      // feature, and the floor check below already guarantees a remaining usable login.
      const session = await getCurrentSession();

      if (!session) {
        throw new ActionError("NOT_AUTHORIZED", { key: "Client.Errors.notAuthenticated" });
      }

      const { provider } = c.req.valid("param");

      await unbindIdentity({ userId: session.user.id, provider });

      return c.json({ success: true });
    },
  );
