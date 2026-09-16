import { describe, expect, it } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  nextTheme,
  normaliseTheme,
  resolveInitialTheme,
  themeFromPreference,
} from "@/lib/theme";

describe("normaliseTheme", () => {
  it("accepts the two values the app writes", () => {
    expect(normaliseTheme("light")).toBe("light");
    expect(normaliseTheme("dark")).toBe("dark");
  });

  it("rejects anything else, including near-misses", () => {
    for (const value of ["Light", "DARK", "", "system", null, undefined, 0, {}]) {
      expect(normaliseTheme(value)).toBeNull();
    }
  });
});

describe("themeFromPreference", () => {
  it("maps the OS preference onto a look", () => {
    expect(themeFromPreference(true)).toBe("dark");
    expect(themeFromPreference(false)).toBe("light");
  });
});

describe("resolveInitialTheme", () => {
  it("prefers an explicit stored choice over the OS", () => {
    expect(resolveInitialTheme("light", true)).toBe("light");
    expect(resolveInitialTheme("dark", false)).toBe("dark");
  });

  it("falls back to the OS when nothing valid is stored", () => {
    expect(resolveInitialTheme(null, true)).toBe("dark");
    expect(resolveInitialTheme("banana", false)).toBe("light");
  });
});

describe("nextTheme", () => {
  it("is a two-way switch", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
    expect(nextTheme(nextTheme("light"))).toBe("light");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  it("reads the same storage key the component writes", () => {
    expect(THEME_INIT_SCRIPT).toContain(THEME_STORAGE_KEY);
  });

  it("is self-contained and cannot throw out of the inline tag", () => {
    expect(THEME_INIT_SCRIPT.startsWith("(function(){")).toBe(true);
    expect(THEME_INIT_SCRIPT).toContain("try{");
    expect(THEME_INIT_SCRIPT).toContain("catch(e){}");
    expect(THEME_INIT_SCRIPT.endsWith("})();")).toBe(true);
  });
});
