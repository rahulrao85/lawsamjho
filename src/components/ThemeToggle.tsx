"use client";

import { useSyncExternalStore } from "react";
import { nextTheme } from "@/lib/theme";
import {
  applyTheme,
  getThemeServerSnapshot,
  getThemeSnapshot,
  subscribeTheme,
} from "@/lib/theme-store";

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );

  return (
    <button
      type="button"
      className="theme-toggle"
      // Read the DOM rather than the rendered value: it is the source of
      // truth, and it is already correct even if two clicks land in the same
      // task (React has not re-rendered between them yet).
      onClick={() => applyTheme(nextTheme(getThemeSnapshot()))}
      aria-label={`Switch to ${nextTheme(theme)} theme`}
      title={`Switch to ${nextTheme(theme)} theme`}
    />
  );
}
