import { describe, expect, test, vi } from "vitest";

// The service module is `server-only`; the plain unit runner stubs that package out (same mock
// the colocated billing tests use).
vi.mock("server-only", () => ({}));

import { PROJECT_CATEGORIES, PROJECT_MAX_FILE_SIZE } from "@/constants";
import {
  marketListQuerySchema,
  projectCreateSchema,
  projectVersionSchema,
} from "@/schemas/api/projects-mobile.schema";
import { v } from "@/lib/validation";

// Wire-format tests for the project publish contract (AutoJs6 account module P3). The CAS
// state-machine behavior lives in D1 (meta.changes) and is covered by the integration surface;
// these pin what both the App and the REST layer validate against.

describe("project create schema", () => {
  const valid = {
    packageName: "com.example.script",
    name: "My Script",
    category: "tools",
    versionCode: 1,
    versionName: "1.0.0",
  };

  test("accepts the minimal form", () => {
    expect(v.safeParse(projectCreateSchema, valid).success).toBe(true);
  });

  test("accepts optional summary and tags", () => {
    expect(
      v.safeParse(projectCreateSchema, {
        ...valid,
        summary: "Does a thing",
        tags: "tools,utility",
      }).success,
    ).toBe(true);
  });

  test("rejects a package name without a reverse-domain dot", () => {
    expect(v.safeParse(projectCreateSchema, { ...valid, packageName: "justascript" }).success).toBe(
      false,
    );
  });

  test("rejects a package name starting with a digit segment", () => {
    expect(v.safeParse(projectCreateSchema, { ...valid, packageName: "com.1example.script" })
      .success).toBe(false);
  });

  test("rejects an unknown category", () => {
    expect(v.safeParse(projectCreateSchema, { ...valid, category: "bizarre" }).success).toBe(false);
  });

  test("covers every category constant", () => {
    for (const category of PROJECT_CATEGORIES) {
      expect(v.safeParse(projectCreateSchema, { ...valid, category }).success).toBe(true);
    }
  });

  test("rejects versionCode below 1 or fractional", () => {
    expect(v.safeParse(projectCreateSchema, { ...valid, versionCode: 0 }).success).toBe(false);
    expect(v.safeParse(projectCreateSchema, { ...valid, versionCode: 1.5 }).success).toBe(false);
  });
});

describe("project version schema", () => {
  test("accepts a plain version pair", () => {
    expect(
      v.safeParse(projectVersionSchema, { versionCode: 2, versionName: "1.1.0" }).success,
    ).toBe(true);
  });

  test("rejects an empty versionName", () => {
    expect(
      v.safeParse(projectVersionSchema, { versionCode: 2, versionName: "  " }).success,
    ).toBe(false);
  });
});

describe("market list query schema", () => {
  test("accepts an empty query", () => {
    expect(v.safeParse(marketListQuerySchema, {}).success).toBe(true);
  });

  test("caps pageSize at 50", () => {
    expect(v.safeParse(marketListQuerySchema, { pageSize: 50 }).success).toBe(true);
    expect(v.safeParse(marketListQuerySchema, { pageSize: 51 }).success).toBe(false);
  });
});

describe("upload cap", () => {
  test("is 20MB", () => {
    expect(PROJECT_MAX_FILE_SIZE).toBe(20 * 1024 * 1024);
  });
});
