/**
 * Theme constants shared by the server (root layout) and the client provider.
 *
 * The preference is kept in localStorage as "light" | "dark" | "system"; the
 * cookie holds the *resolved* theme ("light" | "dark") so the server can put
 * the right class on <html> in the HTML it sends, with no blocking script and
 * no flash of the wrong theme.
 */

export const THEME_COOKIE = "sreemedhas-theme";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** A cookie value that is not a recognised theme means light, as before. */
export function parseThemeCookie(value: string | undefined): ResolvedTheme {
  return value === "dark" ? "dark" : "light";
}
