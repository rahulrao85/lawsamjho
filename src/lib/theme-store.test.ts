import { describe, expect, it } from "vitest";
import {
  applyTheme,
  getThemeServerSnapshot,
  getThemeSnapshot,
  subscribeTheme,
} from "@/lib/theme-store";

describe("theme-store", () => {
  it("getThemeServerSnapshot always returns light", () => {
    expect(getThemeServerSnapshot()).toBe("light");
  });

  it("getThemeSnapshot falls back to light in a non-browser environment", () => {
    expect(getThemeSnapshot()).toBe("light");
  });

  it("subscribeTheme allows adding and removing listeners without throwing in node", () => {
    let called = 0;
    const unsubscribe = subscribeTheme(() => {
      called += 1;
    });

    applyTheme("dark");
    expect(called).toBe(1);

    unsubscribe();
    applyTheme("light");
    expect(called).toBe(1);
  });

  it("applyTheme notifies subscribers and sets theme", () => {
    const notifications: string[] = [];
    const unsubscribe = subscribeTheme(() => {
      notifications.push("notified");
    });

    applyTheme("dark");
    applyTheme("light");

    expect(notifications).toEqual(["notified", "notified"]);
    unsubscribe();
  });
});
