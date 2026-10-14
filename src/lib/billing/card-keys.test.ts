import { describe, expect, test, vi } from "vitest";

// The service module is `server-only`; the plain unit runner stubs that package out (same mock
// the colocated account tests use).
vi.mock("server-only", () => ({}));

import { parseRedeemCode, isValidCardKeyCode } from "@/lib/billing/card-keys";

// Pure-logic tests for the card-key code format. The CAS/concurrency behavior lives in D1
// (meta.changes) and is covered by the integration suite; these pin the wire format both the
// admin generator and the app's input field validate against.

describe("card key code format", () => {
  test("accepts the hyphenated display form", () => {
    expect(parseRedeemCode("2345-6789-ABCD-EFGH")).toBe("2345-6789-ABCD-EFGH");
  });

  test("accepts the bare 16-char form and normalizes to groups", () => {
    expect(parseRedeemCode("23456789abcdefgh")).toBe("2345-6789-ABCD-EFGH");
  });

  test("is case and whitespace insensitive", () => {
    expect(parseRedeemCode("  2345 6789 abcD efgh \n")).toBe("2345-6789-ABCD-EFGH");
  });

  test("rejects wrong lengths", () => {
    expect(parseRedeemCode("2345-6789-ABCD")).toBeNull();
    expect(parseRedeemCode("2345-6789-ABCD-EFGH-XYZW")).toBeNull();
    expect(parseRedeemCode("")).toBeNull();
  });

  test("rejects look-alike characters (0/O/1/I)", () => {
    expect(parseRedeemCode("2305-6789-ABCD-EFGH")).toBeNull();
    expect(parseRedeemCode("2345-6789-OBCD-EFGH")).toBeNull();
    expect(parseRedeemCode("2345-6789-ABCD-EFG1")).toBeNull();
  });

  test("rejects characters outside the code alphabet", () => {
    expect(parseRedeemCode("2345-6789-ABCD-EF;H")).toBeNull();
    expect(parseRedeemCode("2345-6789-ABCD-EF材")).toBeNull();
  });

  test("isValidCardKeyCode agrees with the parser", () => {
    expect(isValidCardKeyCode("2345-6789-ABCD-EFGH")).toBe(true);
    expect(isValidCardKeyCode("0123-4567-89AB-CDEF")).toBe(false);
  });
});
