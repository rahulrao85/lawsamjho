/**
 * Reading the stored theme is a one-liner, but it is the one piece of the
 * theme switch that both the pre-paint inline script and the React toggle
 * must agree on exactly. Keeping it here means there is a single definition
 * to test rather than a string duplicated in a <script> tag and a component.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "lawsamjho-theme";

/** Only trust values we actually wrote. Anything else -> OS preference. */
export function normaliseTheme(value: unknown): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function themeFromPreference(prefersDark: boolean): Theme {
  return prefersDark ? "dark" : "light";
}

/** Resolve the theme to paint, in priority order: stored -> OS -> light. */
export function resolveInitialTheme(
  storedValue: unknown,
  prefersDark: boolean,
): Theme {
  return normaliseTheme(storedValue) ?? themeFromPreference(prefersDark);
}

export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/**
 * Runs before first paint so the page never flashes the wrong look.
 * Kept as a string (not a React component) because it has to be inlined.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var s=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var t=s==="light"||s==="dark"?s:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=t;}catch(e){}})();`;
