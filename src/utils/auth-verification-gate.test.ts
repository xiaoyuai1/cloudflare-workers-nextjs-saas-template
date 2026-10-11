import { beforeEach, describe, expect, test, vi } from "vitest";

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};

const getKVSessionMock = vi.fn();
const touchUserLastActiveAtMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("react", () => ({
  cache: (fn: (...args: unknown[]) => unknown) => fn,
}));

vi.mock("./kv-session", () => ({
  CURRENT_SESSION_VERSION: 7,
  createKVSession: vi.fn(),
  deleteKVSession: vi.fn(),
  getKVSession: getKVSessionMock,
  updateKVSession: vi.fn(),
}));

vi.mock("@/utils/user-activity", () => ({
  touchUserLastActiveAt: touchUserLastActiveAtMock,
}));

vi.mock("@/utils/trace", () => ({
  withSpan: vi.fn(async ({ run }: { run: (span: unknown) => Promise<unknown> }) =>
    run({ setAttribute: vi.fn() })),
}));

const { EMAIL_VERIFICATION_REQUIRED } = await import("@/constants");
const { requireVerifiedEmail } = await import("./auth");

function buildStoredSession({ emailVerified = null }: { emailVerified?: Date | null } = {}) {
  return {
    id: "kv-session-1",
    userId: "user-1",
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    version: 7,
    kind: "cookie",
    user: {
      id: "user-1",
      email: "user@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      emailVerified,
      bannedAt: null,
    },
  };
}

describe("requireVerifiedEmail gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieStore.get.mockReturnValue({ value: "user-1:token-1" });
    getKVSessionMock.mockResolvedValue(buildStoredSession());
  });

  // The kill-switch path: a fork without the EMAIL binding cannot deliver a verification link,
  // so the gate must let an unverified signed-in account through instead of FORBIDDEN-ing every
  // write behind an undeliverable email.
  test.skipIf(EMAIL_VERIFICATION_REQUIRED)(
    "admits an unverified signed-in account when verification is not required",
    async () => {
      getKVSessionMock.mockResolvedValue(buildStoredSession({ emailVerified: null }));

      await expect(requireVerifiedEmail()).resolves.toMatchObject({ userId: "user-1" });
      await expect(
        requireVerifiedEmail({ doNotThrowError: true }),
      ).resolves.toMatchObject({ userId: "user-1" });
    },
  );

  test.skipIf(EMAIL_VERIFICATION_REQUIRED)(
    "still refuses an anonymous caller when verification is not required",
    async () => {
      cookieStore.get.mockReturnValue(undefined);

      await expect(requireVerifiedEmail()).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
      await expect(requireVerifiedEmail({ doNotThrowError: true })).resolves.toBeNull();
    },
  );

  // Locks the default-on contract the skipped tests above relax, so a fork flipping the switch
  // back to true re-enables the documented refusal.
  test.skipIf(!EMAIL_VERIFICATION_REQUIRED)(
    "refuses an unverified signed-in account when verification is required",
    async () => {
      getKVSessionMock.mockResolvedValue(buildStoredSession({ emailVerified: null }));

      await expect(requireVerifiedEmail()).rejects.toMatchObject({
        code: "FORBIDDEN",
        messageKey: "Client.Errors.emailVerificationRequired",
      });
      await expect(requireVerifiedEmail({ doNotThrowError: true })).resolves.toBeNull();
    },
  );

  test.skipIf(!EMAIL_VERIFICATION_REQUIRED)(
    "admits a verified signed-in account when verification is required",
    async () => {
      getKVSessionMock.mockResolvedValue(buildStoredSession({ emailVerified: new Date() }));

      await expect(requireVerifiedEmail()).resolves.toMatchObject({ userId: "user-1" });
    },
  );
});
