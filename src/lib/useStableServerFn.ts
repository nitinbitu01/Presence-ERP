// src/lib/useStableServerFn.ts
// ─────────────────────────────────────────────────────────────────────────────
// Wraps useServerFn in a stable callback that never changes identity.
// Fixes the fnsRef anti-pattern (side effect during render).
// ─────────────────────────────────────────────────────────────────────────────
import { useRef, useCallback } from "react";

type AnyFn = (...args: never[]) => unknown;

/**
 * Returns a stable function reference wrapping the server function.
 * The returned function's identity never changes between renders,
 * making it safe to use in useEffect dependency arrays and useQuery queryFn.
 */
export function useStableServerFn<T extends AnyFn>(
  serverFn: T,
): (...args: Parameters<T>) => ReturnType<T> {
  const ref = useRef<T>(serverFn);
  ref.current = serverFn;
  return useCallback(
    (...args: Parameters<T>) => ref.current(...args) as ReturnType<T>,
    [],
  );
}
