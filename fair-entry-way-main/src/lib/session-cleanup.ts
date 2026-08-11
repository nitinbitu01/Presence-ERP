import type { QueryClient } from "@tanstack/react-query";

/**
 * Clears ALL user-specific frontend state so that when a different account
 * logs in, no stale data (profile name, subjects, cached queries, session
 * tokens) leaks across accounts.
 */
export function clearUserSessionState(queryClient?: QueryClient | null): void {
  try {
    queryClient?.clear();
  } catch (e) {
    console.warn("[session-cleanup] queryClient.clear() failed:", e);
  }

  const USER_SCOPED_KEYS = [
    "presence_active_session_id",
    "sb-auth-token",
    "sb-refresh-token",
    "supabase.auth.token",
    "presence_user_id",
    "presence_profile",
  ];
  try {
    for (const key of USER_SCOPED_KEYS) {
      localStorage.removeItem(key);
    }
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const lower = key.toLowerCase();
      if (
        lower.includes("auth") ||
        lower.includes("session") ||
        lower.includes("token") ||
        lower.includes("user") ||
        lower.includes("profile")
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn("[session-cleanup] localStorage cleanup failed:", e);
  }

  try {
    sessionStorage.clear();
  } catch (e) {
    console.warn("[session-cleanup] sessionStorage.clear() failed:", e);
  }
}
