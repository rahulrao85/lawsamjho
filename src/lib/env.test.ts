import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ConfigError,
  describeServerEnv,
  getServerEnv,
  resetServerEnvCache,
} from "@/lib/env";

const MANAGED_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODEL",
  "MAX_UPLOAD_BYTES",
  "RATE_LIMIT_MAX",
  "RATE_LIMIT_WINDOW_MS",
] as const;

const original: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of MANAGED_KEYS) {
    original[key] = process.env[key];
    delete process.env[key];
  }
  resetServerEnvCache();
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetServerEnvCache();
});

describe("getServerEnv", () => {
  it("throws a ConfigError naming the missing key", () => {
    expect(() => getServerEnv()).toThrow(ConfigError);
    expect(describeServerEnv().issues.join(" ")).toContain("GEMINI_API_KEY");
  });

  it("applies documented defaults once the key is present", () => {
    process.env.GEMINI_API_KEY = "test-key";
    const env = getServerEnv();
    expect(env.GEMINI_MODEL).toBe("gemini-3.6-flash");
    expect(env.GEMINI_FALLBACK_MODEL).toBe("gemini-3.5-flash");
    expect(env.MAX_UPLOAD_BYTES).toBe(2_000_000);
    expect(env.RATE_LIMIT_MAX).toBe(20);
    expect(env.RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  it("coerces numeric env vars and rejects nonsense ones", () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.MAX_UPLOAD_BYTES = "512000";
    expect(getServerEnv().MAX_UPLOAD_BYTES).toBe(512_000);

    resetServerEnvCache();
    process.env.MAX_UPLOAD_BYTES = "not-a-number";
    expect(() => getServerEnv()).toThrow(ConfigError);
  });

  it("treats an empty key as missing rather than valid", () => {
    process.env.GEMINI_API_KEY = "";
    expect(() => getServerEnv()).toThrow(ConfigError);
  });

  it("memoises a successful parse", () => {
    process.env.GEMINI_API_KEY = "first";
    const first = getServerEnv();
    process.env.GEMINI_API_KEY = "second";
    expect(getServerEnv()).toBe(first);
  });
});

describe("describeServerEnv", () => {
  it("never throws -- it reports", () => {
    expect(() => describeServerEnv()).not.toThrow();
    expect(describeServerEnv().ok).toBe(false);

    process.env.GEMINI_API_KEY = "test-key";
    resetServerEnvCache();
    const described = describeServerEnv();
    expect(described.ok).toBe(true);
    expect(described.issues).toEqual([]);
  });
});
