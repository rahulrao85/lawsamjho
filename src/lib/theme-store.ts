import { THEME_STORAGE_KEY, normaliseTheme, type Theme } from "@/lib/theme";

/**
 * The `<html data-theme>` attribute is the source of truth, not React state.
 * The pre-paint script writes it before hydration, so mirroring it into a
 * component effect would mean a second render on every load just to agree with
 * something the DOM already knows. Reading it through an external store keeps
 * the DOM authoritative and gives React a value to subscribe to directly.
 */

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener);

  if (typeof window === "undefined") {
    return () => listeners.delete(listener);
  }

  // Keeps other tabs of the same app in step.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function getThemeSnapshot(): Theme {
  if (typeof document === "undefined") return "light";
  return normaliseTheme(document.documentElement.dataset.theme) ?? "light";
}

export function getThemeServerSnapshot(): Theme {
  return "light";
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private mode); the paint still happened.
  }
  emit();
}
