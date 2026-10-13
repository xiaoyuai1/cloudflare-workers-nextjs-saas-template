import { beforeEach, describe, expect, test, vi } from "vitest";

const { getCloudflareContextMock } = vi.hoisted(() => ({
  getCloudflareContextMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/utils/cloudflare-context", () => ({
  getCloudflareContext: getCloudflareContextMock,
}));

const { resolveEmailProvider } = await import("./resolve-provider");

function withEnv(env: Record<string, unknown>): void {
  getCloudflareContextMock.mockResolvedValue({ env });
}

describe("resolveEmailProvider", () => {
  beforeEach(() => {
    getCloudflareContextMock.mockReset();
  });

  test("defaults to cloudflare and requires the binding plus EMAIL_FROM", async () => {
    withEnv({ EMAIL: { send: () => {} }, EMAIL_FROM: "no-reply@example.com" });

    await expect(resolveEmailProvider()).resolves.toEqual({ kind: "cloudflare" });
  });

  test("cloudflare without the binding is unavailable", async () => {
    withEnv({ EMAIL_FROM: "no-reply@example.com" });

    const decision = await resolveEmailProvider();

    expect(decision.kind).toBe("unavailable");
    expect(decision.kind === "unavailable" && decision.reason).toContain("EMAIL");
  });

  test("cloudflare without EMAIL_FROM is unavailable", async () => {
    withEnv({ EMAIL: { send: () => {} } });

    const decision = await resolveEmailProvider();

    expect(decision.kind).toBe("unavailable");
    expect(decision.kind === "unavailable" && decision.reason).toContain("EMAIL_FROM");
  });

  test("smtp with a complete QQ-style config resolves the fixed 465 port", async () => {
    withEnv({
      EMAIL_PROVIDER: "smtp",
      EMAIL_SMTP_HOST: "smtp.qq.com",
      EMAIL_SMTP_USER: "sender@qq.com",
      EMAIL_SMTP_PASS: "auth-code",
      EMAIL_FROM: "sender@qq.com",
      EMAIL_FROM_NAME: "SaaS Template",
      EMAIL_REPLY_TO: "support@qq.com",
    });

    expect(await resolveEmailProvider()).toEqual({
      kind: "smtp",
      smtp: {
        host: "smtp.qq.com",
        port: 465,
        user: "sender@qq.com",
        pass: "auth-code",
        from: { email: "sender@qq.com", name: "SaaS Template" },
        replyTo: "support@qq.com",
      },
    });
  });

  test("smtp omits optional fields when absent", async () => {
    withEnv({
      EMAIL_PROVIDER: "smtp",
      EMAIL_SMTP_HOST: "smtp.qq.com",
      EMAIL_SMTP_USER: "sender@qq.com",
      EMAIL_SMTP_PASS: "auth-code",
      EMAIL_FROM: "sender@qq.com",
    });

    const decision = await resolveEmailProvider();

    expect(decision).toEqual({
      kind: "smtp",
      smtp: {
        host: "smtp.qq.com",
        port: 465,
        user: "sender@qq.com",
        pass: "auth-code",
        from: { email: "sender@qq.com" },
      },
    });
  });

  test("smtp missing one variable names every missing variable", async () => {
    withEnv({
      EMAIL_PROVIDER: "smtp",
      EMAIL_SMTP_HOST: "smtp.qq.com",
      EMAIL_SMTP_PASS: "auth-code",
      EMAIL_FROM: "sender@qq.com",
    });

    const decision = await resolveEmailProvider();

    expect(decision.kind).toBe("unavailable");
    expect(decision.kind === "unavailable" && decision.reason).toContain("EMAIL_SMTP_USER");
  });

  test("an unknown provider name is unavailable", async () => {
    withEnv({ EMAIL_PROVIDER: "carrier-pigeon" });

    const decision = await resolveEmailProvider();

    expect(decision.kind).toBe("unavailable");
    expect(decision.kind === "unavailable" && decision.reason).toContain("carrier-pigeon");
  });
});
