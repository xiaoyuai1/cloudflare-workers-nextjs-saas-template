import "server-only";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import { APP_KV_PREFIXES } from "@/constants/kv-prefixes";
import { createBase64UrlToken, hashToken } from "@/utils/random-token";

// Mobile-app sessions (AutoJs6 account module). A bearer token the app stores itself, mirroring
// the web KV session's trust model but without cookies: the raw token never touches storage —
// KV is keyed by its SHA-256 — and every successful verification slides the 90-day expiry
// forward, so an actively used app stays signed in and an abandoned one ages out.
//
// design reference: sub2api (Wei-Shaw/sub2api, LGPL-3.0) docs/PAYMENT.md — mobile session token.

const MSESSION_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days, sliding on every verification.
const MSESSION_TOKEN_BYTES = 48;

const MSESSION_PREFIX = APP_KV_PREFIXES.msession;

export interface MsessionRecord {
  userId: string;
  deviceId: string;
  /** Epoch ms of the last successful verification; the sliding-expiry anchor. */
  lastSeenAt: number;
  /** Epoch ms this record dies unless renewed. informational; the KV TTL enforces it. */
  expiresAt: number;
}

function getMsessionKey(tokenHash: string): string {
  return `${MSESSION_PREFIX}${tokenHash}`;
}

async function getKV() {
  const { env } = await getCloudflareContext();

  if (!env.KV_STORE) {
    throw new Error("Can't connect to KV store");
  }

  return env.KV_STORE;
}

/** The only time the raw token exists outside the HTTP response; storage sees the hash only. */
export function createMsessionTokenValue(): string {
  return createBase64UrlToken(MSESSION_TOKEN_BYTES);
}

export async function createMsessionToken({
  userId,
  deviceId,
}: {
  userId: string;
  deviceId: string;
}): Promise<string> {
  const token = createMsessionTokenValue();
  const tokenHash = await hashToken(token);
  const now = Date.now();

  const record: MsessionRecord = {
    userId,
    deviceId,
    lastSeenAt: now,
    expiresAt: now + MSESSION_TTL_SECONDS * 1000,
  };

  const kv = await getKV();
  await kv.put(getMsessionKey(tokenHash), JSON.stringify(record), {
    expirationTtl: MSESSION_TTL_SECONDS,
  });

  return token;
}

/**
 * Verify a bearer msession token and slide its expiry forward. Returns null for anything that
 * does not resolve to a live record; never throws for bad input, so callers can map null onto 401.
 */
export async function verifyMsessionToken(token: string): Promise<MsessionRecord | null> {
  if (!token || token.length < 32 || /[^A-Za-z0-9_-]/.test(token)) {
    return null;
  }

  const tokenHash = await hashToken(token);
  const kv = await getKV();
  const key = getMsessionKey(tokenHash);
  const raw = await kv.get<MsessionRecord>(key, "json");

  if (!raw || typeof raw.userId !== "string" || typeof raw.deviceId !== "string") {
    return null;
  }

  // Sliding expiry: renew at most once an hour so a hot client does not burn a KV write per
  // request, mirroring how the API-key snapshot throttles its last-used stamp.
  const now = Date.now();
  if (now - raw.lastSeenAt > 60 * 60 * 1000) {
    const renewed: MsessionRecord = {
      ...raw,
      lastSeenAt: now,
      expiresAt: now + MSESSION_TTL_SECONDS * 1000,
    };

    await kv.put(key, JSON.stringify(renewed), { expirationTtl: MSESSION_TTL_SECONDS });
  }

  return raw;
}

/** Revoke every msession of a user (password change, binding removal, ban). */
export async function revokeMsessionByUser(userId: string): Promise<void> {
  const kv = await getKV();
  const keys = await kv.list({ prefix: MSESSION_PREFIX });

  for (const key of keys.keys) {
    const record = await kv.get<MsessionRecord>(key.name, "json");

    if (record?.userId === userId) {
      await kv.delete(key.name);
    }
  }
}

/** Revoke one device's msession (per-device sign-out). */
export async function revokeMsessionByDevice({
  userId,
  deviceId,
}: {
  userId: string;
  deviceId: string;
}): Promise<void> {
  const kv = await getKV();
  const keys = await kv.list({ prefix: MSESSION_PREFIX });

  for (const key of keys.keys) {
    const record = await kv.get<MsessionRecord>(key.name, "json");

    if (record?.userId === userId && record.deviceId === deviceId) {
      await kv.delete(key.name);
    }
  }
}
