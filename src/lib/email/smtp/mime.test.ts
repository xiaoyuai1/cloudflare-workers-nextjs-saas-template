import { describe, expect, it } from "vitest";

import {
  encodeBody,
  encodeHeader,
  formatFromHeader,
  fromBase64,
  toBase64,
} from "./mime";

describe("toBase64 / fromBase64", () => {
  it("round-trips ASCII", () => {
    expect(toBase64("hello world")).toBe("aGVsbG8gd29ybGQ=");
    expect(fromBase64("aGVsbG8gd29ybGQ=")).toBe("hello world");
  });

  it("round-trips multibyte UTF-8", () => {
    const text = "密码重置 — SaaS 模板";
    expect(fromBase64(toBase64(text))).toBe(text);
  });
});

describe("encodeHeader", () => {
  it("leaves pure ASCII untouched", () => {
    expect(encodeHeader("Password reset")).toBe("Password reset");
  });

  it("B-encodes Chinese text and round-trips", () => {
    const encoded = encodeHeader("密码重置");

    expect(encoded).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/]+\?=$/);
    // Decode the encoded-word payload and confirm the original text survives.
    const payload = encoded.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, "").replaceAll("\r\n ", "");
    expect(fromBase64(payload)).toBe("密码重置");
  });

  it("folds long Chinese subjects into multiple encoded-words without splitting characters", () => {
    const subject = "这是一个非常长的中文邮件主题".repeat(6);
    const encoded = encodeHeader(subject);
    const decoded = encoded
      .split("\r\n ")
      .map((line) => fromBase64(line.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, "")))
      .join("");

    expect(decoded).toBe(subject);
    for (const line of encoded.split("\r\n ")) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
  });

  it("round-trips emoji (surrogate pairs)", () => {
    const text = "🔐 安全重置 🔑";
    const encoded = encodeHeader(text);
    const decoded = encoded
      .split("\r\n ")
      .map((line) => fromBase64(line.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, "")))
      .join("");

    expect(decoded).toBe(text);
  });
});

describe("formatFromHeader", () => {
  it("returns the bare address without a name", () => {
    expect(formatFromHeader({ email: "no-reply@example.com" })).toBe("no-reply@example.com");
  });

  it("keeps a simple ASCII name unquoted", () => {
    expect(formatFromHeader({ email: "a@b.com", name: "SaaS" })).toBe("SaaS <a@b.com>");
  });

  it("quotes ASCII names with specials", () => {
    expect(formatFromHeader({ email: "a@b.com", name: "Doe, John" })).toBe('"Doe, John" <a@b.com>');
  });

  it("encodes non-ASCII names", () => {
    const header = formatFromHeader({ email: "a@b.com", name: "模板" });

    expect(header).toBe(`${encodeHeader("模板")} <a@b.com>`);
  });
});

describe("encodeBody", () => {
  it("folds base64 at 76 columns", () => {
    const encoded = encodeBody("x".repeat(200));

    for (const line of encoded.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(76);
    }

    expect(fromBase64(encoded.replaceAll("\r\n", ""))).toBe("x".repeat(200));
  });

  it("round-trips Chinese bodies", () => {
    const body = "<p>你好,这是一封测试邮件。</p>";
    expect(fromBase64(encodeBody(body))).toBe(body);
  });
});
