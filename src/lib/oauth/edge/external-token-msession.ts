import "server-only";

import type { MobileSessionBearerProps } from "@/lib/oauth/bearer-props";
import { API_SCOPE_NAMES } from "@/lib/api/scopes";
import { PERSONAL_AUDIENCE } from "@/lib/api/principal";
import { isBanned } from "@/lib/account/ban";
import { verifyMsessionToken } from "@/utils/msession";
import { loadPrincipalIdentity, reviveUserDates } from "@/utils/kv-principal-cache";

// The single auth funnel's mobile-session half: a bearer token that is neither one of the
// provider's own nor an API key gets one chance to be an msession (AutoJs6 account module).
// Returning props authenticates the request; null yields the provider's `invalid_token` response.
// fallow-ignore-next-line unused-export -- Reached through a lazy `import()` in worker-entrypoint.ts.
export async function resolveMsessionToken(
  token: string,
): Promise<{ props: MobileSessionBearerProps } | null> {
  const record = await verifyMsessionToken(token);

  if (!record) {
    return null;
  }

  const identity = await loadPrincipalIdentity(record.userId);

  if (!identity || isBanned(identity.user)) {
    return null;
  }

  return {
    props: {
      credentialKind: "mobile-session",
      principal: {
        kind: "mobile-session",
        userId: record.userId,
        user: reviveUserDates(identity.user),
        teams: identity.teams,
        scopes: API_SCOPE_NAMES,
        audience: PERSONAL_AUDIENCE,
        deviceId: record.deviceId,
      },
    },
  };
}
