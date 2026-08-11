// src/lib/useRetryWithBackoff.ts
// ─────────────────────────────────────────────────────────────────────────────
// Exponential backoff retry hook for manual retry buttons.
// Prevents users from hammering the server on error.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useCallback, useRef } from "react";

interface RetryState {
  attemptCount: number;
  nextRetryMs: number;
  isWaiting: boolean;
}

/**
 * Returns a wrapped retry function that enforces exponential backoff.
 * First retry: immediate
 * Second retry: 2s delay
 * Third retry: 4s delay
 * Nth retry: min(2^(n-1) * 1000, 30000)ms delay
 */
export function useRetryWithBackoff(fn: () => void) {
  const [state, setState] = useState<RetryState>({
    attemptCount: 0,
    nextRetryMs: 0,
    isWaiting: false,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const retry = useCallback(() => {
    if (state.isWaiting) return;

    const delay =
      state.attemptCount === 0
        ? 0
        : Math.min(Math.pow(2, state.attemptCount - 1) * 1000, 30_000);

    if (delay === 0) {
      setState((s) => ({ ...s, attemptCount: s.attemptCount + 1 }));
      fn();
      return;
    }

    setState((s) => ({
      attemptCount: s.attemptCount + 1,
      nextRetryMs: delay,
      isWaiting: true,
    }));

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setState((s) => ({ ...s, isWaiting: false, nextRetryMs: 0 }));
      fn();
    }, delay);
  }, [state, fn]);

  const reset = useCallback(() => {
    clearTimeout(timerRef.current);
    setState({ attemptCount: 0, nextRetryMs: 0, isWaiting: false });
  }, []);

  return {
    retry,
    reset,
    attemptCount: state.attemptCount,
    isWaiting: state.isWaiting,
    nextRetryMs: state.nextRetryMs,
  };
}
