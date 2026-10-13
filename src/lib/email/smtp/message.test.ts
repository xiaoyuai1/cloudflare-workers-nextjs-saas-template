import { describe, expect, it } from "vitest";

import { buildMimeMessage, dotStuff } from "./message";
import { fromBase64 } from "./mime";
import type { SmtpEmailConfig } from "../types";

const config: SmtpEmailConfig = {
  host: "smtp.qq.com",
  port: 465,
  user: "sender@qq.com",
  pass: "auth-code",
  from: { email: "sender@qq.com", name: "SaaS Template" },
};

describe("buildMimeMessage", () => {
  it("builds headers and a multipart/alternative body", () => {
    const message = buildMimeMessage(config, {
      to: "to@qq.com",
      subject: "Verify",
      text: "plain body",
      html: "<p>html body</p>",
      headers: { "X-Transactional-Email-Type": "email-verification" },
    });

    expect(message).toContain("From: SaaS Template <sender@qq.com>");
    expect(message).toContain("To: to@qq.com");
    expect(message).toContain("Subject: Verify");
    expect(message).toContain("X-Transactional-Email-Type: email-verification");
    expect(message).toContain("MIME-Version: 1.0");
    expect(message).toContain('Content-Type: multipart/alternative; boundary="');
    expect(message).toContain("Content-Type: text/plain; charset=utf-8");
    expect(message).toContain("Content-Type: text/html; charset=utf-8");
    expect(message.trimEnd().endsWith("--")).toBe(true);
  });

  it("encodes a Chinese subject and base64 bodies", () => {
    const message = buildMimeMessage(config, {
      to: "to@qq.com",
      subject: "重置密码",
      text: "中文正文",
    });

    expect(message).toMatch(/Subject: =\?UTF-8\?B\?/);
    // The text part decodes back to the original Chinese body.
    const textPart = message.split("Content-Type: text/plain; charset=utf-8")[1];
    const payload = textPart.split("\r\n\r\n")[1].split("\r\n--")[0];
    expect(fromBase64(payload.replaceAll("\r\n", ""))).toBe("中文正文");
  });

  it("includes Reply-To when configured", () => {
    const message = buildMimeMessage(
      { ...config, replyTo: "support@qq.com" },
      { to: "to@qq.com", subject: "s", text: "t" },
    );

    expect(message).toContain("Reply-To: support@qq.com");
  });

  it("throws with neither text nor html", () => {
    expect(() =>
      buildMimeMessage(config, { to: "to@qq.com", subject: "s" }),
    ).toThrow("at least one of text or html");
  });
});

describe("dotStuff", () => {
  it("escapes a lone leading dot line", () => {
    expect(dotStuff("line one\r\n.\r\nline two")).toBe("line one\r\n..\r\nline two");
  });

  it("leaves ordinary content unchanged", () => {
    expect(dotStuff("no dots\r\nhere")).toBe("no dots\r\nhere");
  });
});
