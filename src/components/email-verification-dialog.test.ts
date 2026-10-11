import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useSessionStore } from "@/state/session";

const executeMock = vi.fn();

vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ execute: executeMock, status: "idle" }),
}));

// The component only passes the action to useAction, but the real module carries `server-only`
// into this client-side test graph through the action chain.
vi.mock("@/app/[locale]/(auth)/send-verification.action", () => ({
  sendVerificationAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/i18n/client", () => ({
  useTranslations: () => (key: string) => key,
}));

const pathnameMock = vi.fn(() => "/dashboard");

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => pathnameMock(),
}));

const { EMAIL_VERIFICATION_REQUIRED } = await import("@/constants");
const { EmailVerificationDialog } = await import("./email-verification-dialog");

function createSession(emailVerified: Date | null) {
  const now = Date.now();

  return {
    id: "kv-session-1",
    userId: "user-1",
    createdAt: now,
    expiresAt: now + 60_000,
    version: 7,
    kind: "cookie" as const,
    user: {
      id: "user-1",
      email: "user@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      role: "user" as const,
      emailVerified,
      avatar: null,
      preferredLocale: null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
      bannedAt: null,
    },
  };
}

function renderDialogWithSession(emailVerified: Date | null): string {
  useSessionStore.getState().setSession(createSession(emailVerified));

  return renderToStaticMarkup(createElement(EmailVerificationDialog));
}

describe("EmailVerificationDialog", () => {
  afterEach(() => {
    useSessionStore.getState().setSession(null);
  });

  test.skipIf(EMAIL_VERIFICATION_REQUIRED)(
    "renders nothing for an unverified signed-in account when verification is not required",
    () => {
      expect(renderDialogWithSession(null)).toBe("");
    },
  );

  test.skipIf(EMAIL_VERIFICATION_REQUIRED)(
    "renders nothing for a verified signed-in account when verification is not required",
    () => {
      expect(renderDialogWithSession(new Date())).toBe("");
    },
  );

  test.skipIf(!EMAIL_VERIFICATION_REQUIRED)(
    "renders for an unverified signed-in account when verification is required",
    () => {
      const html = renderDialogWithSession(null);

      expect(html).toContain("title");
      expect(html).toContain("resend");
    },
  );

  test.skipIf(!EMAIL_VERIFICATION_REQUIRED)(
    "renders nothing for a verified signed-in account when verification is required",
    () => {
      expect(renderDialogWithSession(new Date())).toBe("");
    },
  );

  test.skipIf(!EMAIL_VERIFICATION_REQUIRED)(
    "renders nothing on a bypass page when verification is required",
    () => {
      pathnameMock.mockReturnValue("/");

      expect(renderDialogWithSession(null)).toBe("");
    },
  );
});
