import "server-only";

import type { Context, MiddlewareHandler } from "hono";

import { enforceAnonRateLimit } from "@/api/middleware/rate-limit";
import type { ApiEnv } from "@/api/types";
import { API_KEY_PREFIX_LIVE, MOBILE_AUTH_PUBLIC_PATHS, OAUTH_PROTECTED_RESOURCE_PATH } from "@/constants";
import { ActionError } from "@/lib/action-error";
import { actionErrorToProblem, toProblemResponse } from "@/lib/api/errors";
import {
  getBearerPrincipal,
  PERSONAL_AUDIENCE,
  runWithPrincipal,
  type ApiPrincipal,
} from "@/lib/api/principal";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import { rateLimitHeaders } from "@/lib/api/rate-limit-headers";
import { principalFromBearerProps } from "@/lib/oauth/bearer-props";
import { looksLikeApiKey } from "@/utils/api-key-format";
import { isBanned } from "@/lib/account/ban";
import { verifyMsessionToken } from "@/utils/msession";
import { loadPrincipalIdentity, reviveUserDates } from "@/utils/kv-principal-cache";
import { getApiKeyPrincipal } from "@/utils/kv-api-key";
import { withSpan } from "@/utils/trace";
import type { RateLimitSnapshot } from "@/utils/with-rate-limit";

const AUTH_SPAN_NAME = "app.api.auth";
const AUTH_OUTCOME_ATTRIBUTE = "app.api.auth.outcome";
// Which door admitted the caller, or why none did.
const AUTH_OUTCOMES = {
  INHERITED: "inherited",
  PROPS: "props",
  HEADER: "header",
  PUBLIC: "public",
  MISSING: "missing",
  MALFORMED: "malformed",
  INVALID: "invalid",
} as const;

// The anonymous placeholder for the deliberately-public mobile auth handshake. It grants nothing
// (`profile:read` etc. are enforced from `scopes` by every real guard), it only exists so the
// union type and the `runWithPrincipal` bridge stay uniform; the public routes' `scope: null`
// guard asserts a principal, which this satisfies, and the handler logic is the real gate.
const ANON_PRINCIPAL: ApiPrincipal = {
  kind: "mobile-session",
  userId: "",
  user: {
    id: "",
    email: null,
    firstName: null,
    lastName: null,
    nickname: null,
    avatar: null,
    role: "user",
    emailVerified: null,
    preferredLocale: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    bannedAt: null,
  },
  teams: [],
  scopes: [],
  audience: { type: "personal" },
  deviceId: "",
};

const BEARER_SCHEME = "Bearer ";
const MISSING_CREDENTIAL_DETAIL = "A bearer credential is required.";
const INVALID_CREDENTIAL_DETAIL = "The bearer credential is not valid.";

function readBearerToken(header: string | undefined): string | null {
  if (!header || !header.startsWith(BEARER_SCHEME)) {
    return null;
  }

  return header.slice(BEARER_SCHEME.length).trim() || null;
}

function unauthorized({
  c,
  detail,
  tokenPresented,
  quota,
}: {
  c: Context<ApiEnv>;
  detail: string;
  tokenPresented: boolean;
  /** The anonymous bucket this attempt was charged against, so a client can see it draining. */
  quota: RateLimitSnapshot | null;
}): Response {
  const problem = actionErrorToProblem({
    error: new ActionError("NOT_AUTHORIZED", detail),
    request: c.req.raw,
  });

  if (quota) {
    Object.assign(problem.headers, rateLimitHeaders(quota));
  }

  // RFC 9728: the path-suffixed resource metadata URL is how an MCP or OAuth client discovers
  // the authorization server straight from a 401 and starts the connect dance unattended.
  const url = new URL(c.req.url);
  const resourceMetadata = `${url.origin}${OAUTH_PROTECTED_RESOURCE_PATH}${url.pathname}`;

  problem.headers["www-authenticate"] = tokenPresented
    ? `Bearer error="invalid_token", error_description="${INVALID_CREDENTIAL_DETAIL}", resource_metadata="${resourceMetadata}"`
    : `Bearer resource_metadata="${resourceMetadata}"`;

  return toProblemResponse(problem);
}

// The only door into the API. Everything downstream runs inside `runWithPrincipal`, which is what
// makes the existing `src/lib/**` service layer (requireVerifiedEmail, requireTeamPermission)
// authorize bearer callers without a single per-function change.
export const apiAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
  // The span ends before `next()`, so it times the credential check and not the operation.
  const result = await withSpan({
    name: AUTH_SPAN_NAME,
    run: async (span) => {
      const resolved = await resolveApiAuth(c);
      span.setAttribute(AUTH_OUTCOME_ATTRIBUTE, resolved.outcome);

      return resolved;
    },
  });

  if ("response" in result) {
    return result.response;
  }

  // The anonymous mobile-auth handshake publishes its placeholder into both stores: the context
  // copy feeds the authed rate limiter, and the ALS copy is what the route's `scope: null` guard
  // (requirePrincipal) reads. Its empty userId/deviceId collapse the pre-credential traffic onto
  // one shared bucket, which is the intended treatment.
  if (result.outcome === AUTH_OUTCOMES.PUBLIC) {
    c.set("principal", result.principal);
    return runWithPrincipal(result.principal, () => next());
  }

  c.set("principal", result.principal);

  // An inherited principal is already in scope; the other doors publish theirs here.
  return result.outcome === AUTH_OUTCOMES.INHERITED
    ? next()
    : runWithPrincipal(result.principal, () => next());
};

async function resolveApiAuth(c: Context<ApiEnv>): Promise<ApiAuthResult> {
  // In-process dispatch (an MCP tool call) already established the principal before building the
  // request, so it is reused rather than resolved a second time from a credential we do not carry.
  const inherited = getBearerPrincipal();

  if (inherited) {
    return { outcome: AUTH_OUTCOMES.INHERITED, principal: inherited };
  }

  // The mobile auth handshake (register/login/logout) runs before any credential exists. The
  // edge already answered these ahead of the OAuth provider; on a direct Hono dispatch the
  // missing-principal refusal below would be wrong, so they pass through anonymously and the
  // route's own guard (scope: null + handler logic) is the gate.
  const pathname = new URL(c.req.raw.url).pathname;

  if (MOBILE_AUTH_PUBLIC_PATHS.includes(pathname as (typeof MOBILE_AUTH_PUBLIC_PATHS)[number])) {
    return { outcome: AUTH_OUTCOMES.PUBLIC, principal: ANON_PRINCIPAL };
  }

  // In production the OAuth provider has already validated the credential and put its props on
  // `ctx`, and rejects a failed one before this middleware runs. The header path below only serves
  // direct in-process dispatch (tests, MCP) — which is why it charges the anon bucket itself.
  const fromProps = await principalFromBearerProps(c.executionCtx?.props);

  if (fromProps) {
    return { outcome: AUTH_OUTCOMES.PROPS, principal: fromProps };
  }

  const token = readBearerToken(c.req.header("authorization"));

  if (!token) {
    const quota = await enforceAnonRateLimit(c);
    return {
      outcome: AUTH_OUTCOMES.MISSING,
      response: unauthorized({
        c,
        detail: MISSING_CREDENTIAL_DETAIL,
        tokenPresented: false,
        quota,
      }),
    };
  }

  // Mobile-app sessions (AutoJs6 account module) before the API-key sniff: an msession token is
  // plain base64url with no `saas_` prefix, so `looksLikeApiKey` would misclassify it as garbage.
  // The msession token format is the same 48-byte base64url the web session uses, which no
  // API-key prefix can collide with (those all start `saas_`).
  if (!token.startsWith(API_KEY_PREFIX_LIVE)) {
    const record = await verifyMsessionToken(token);

    if (record) {
      const identity = await loadPrincipalIdentity(record.userId);

      if (identity && !isBanned(identity.user)) {
        return {
          outcome: AUTH_OUTCOMES.HEADER,
          principal: {
            kind: "mobile-session",
            userId: record.userId,
            user: reviveUserDates(identity.user),
            teams: identity.teams,
            scopes: API_SCOPE_NAMES,
            audience: PERSONAL_AUDIENCE,
            deviceId: record.deviceId,
          },
        };
      }

      const quota = await enforceAnonRateLimit(c);
      return {
        outcome: AUTH_OUTCOMES.INVALID,
        response: unauthorized({ c, detail: INVALID_CREDENTIAL_DETAIL, tokenPresented: true, quota }),
      };
    }
    // Not an msession either — fall through to the API-key path, whose refusal covers
    // "not a valid credential of any kind we issue".
  }

  // Cheap prefix + checksum sniff: a garbage token never reaches D1 or KV.
  if (!looksLikeApiKey(token)) {
    const quota = await enforceAnonRateLimit(c);
    return {
      outcome: AUTH_OUTCOMES.MALFORMED,
      response: unauthorized({ c, detail: INVALID_CREDENTIAL_DETAIL, tokenPresented: true, quota }),
    };
  }

  const principal = await getApiKeyPrincipal(token);

  if (!principal) {
    const quota = await enforceAnonRateLimit(c);
    return {
      outcome: AUTH_OUTCOMES.INVALID,
      response: unauthorized({ c, detail: INVALID_CREDENTIAL_DETAIL, tokenPresented: true, quota }),
    };
  }

  return { outcome: AUTH_OUTCOMES.HEADER, principal };
}

// Keyed on `outcome`, so only an admitting door can carry a principal, and only a refusal a response.
type ApiAuthResult =
  | { outcome: typeof AUTH_OUTCOMES.INHERITED; principal: ApiPrincipal }
  | { outcome: typeof AUTH_OUTCOMES.PROPS | typeof AUTH_OUTCOMES.HEADER; principal: ApiPrincipal }
  | { outcome: typeof AUTH_OUTCOMES.PUBLIC; principal: ApiPrincipal }
  | {
      outcome: typeof AUTH_OUTCOMES.MISSING | typeof AUTH_OUTCOMES.MALFORMED | typeof AUTH_OUTCOMES.INVALID;
      response: Response;
    };
