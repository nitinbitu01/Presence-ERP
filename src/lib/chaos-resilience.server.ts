/**
 * Phase 8.2 World-Class Chaos Engineering & Circuit Breaker Engine
 * Real production circuit breaker with state machine:
 * CLOSED (normal) → OPEN (failing, use fallback) → HALF_OPEN (probing recovery)
 *
 * Configurable failure thresholds, cooldown periods, and telemetry.
 */

export type DependencyName =
  | "aws_rekognition"
  | "resend_email"
  | "razorpay_payment"
  | "supabase_db"
  | "twilio_sms"
  | "supabase_storage";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold: number; // failures before OPEN
  successThreshold: number; // successes in HALF_OPEN before CLOSED
  cooldownMs: number; // ms to stay OPEN before probing
}

export interface CircuitBreakerStatus {
  dependency: DependencyName;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  nextProbeAt: number | null;
  fallback: string;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  cooldownMs: 60_000, // 1 minute
};

const FALLBACK_MAP: Record<DependencyName, string> = {
  aws_rekognition: "hmac_fallback_challenge",
  resend_email: "sms_whatsapp_dispatcher",
  razorpay_payment: "manual_bank_challan_record",
  supabase_db: "client_side_offline_queue",
  twilio_sms: "whatsapp_dispatcher",
  supabase_storage: "local_file_buffer",
};

// In-process circuit breaker registry (survives request lifetime, resets on server restart)
const circuitRegistry = new Map<DependencyName, CircuitBreakerStatus>();

function getCircuit(dependency: DependencyName): CircuitBreakerStatus {
  if (!circuitRegistry.has(dependency)) {
    circuitRegistry.set(dependency, {
      dependency,
      state: "CLOSED",
      failureCount: 0,
      successCount: 0,
      lastFailureAt: null,
      openedAt: null,
      nextProbeAt: null,
      fallback: FALLBACK_MAP[dependency],
    });
  }
  return circuitRegistry.get(dependency)!;
}

function updateCircuit(dependency: DependencyName, update: Partial<CircuitBreakerStatus>): void {
  const current = getCircuit(dependency);
  circuitRegistry.set(dependency, { ...current, ...update });
}

/**
 * Main circuit breaker wrapper.
 * Calls the provided function if CLOSED or HALF_OPEN.
 * Returns fallback if OPEN or if the call fails and trips the breaker.
 */
export async function withCircuitBreaker<T>(
  dependency: DependencyName,
  fn: () => Promise<T>,
  fallbackFn: () => T | Promise<T>,
  config: Partial<CircuitBreakerConfig> = {},
): Promise<{ result: T; usedFallback: boolean; circuitState: CircuitState }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const circuit = getCircuit(dependency);
  const now = Date.now();

  // OPEN → check if cooldown expired (transition to HALF_OPEN)
  if (circuit.state === "OPEN") {
    if (circuit.nextProbeAt !== null && now >= circuit.nextProbeAt) {
      updateCircuit(dependency, { state: "HALF_OPEN", successCount: 0 });
    } else {
      // Still OPEN — use fallback immediately
      const result = await fallbackFn();
      return { result, usedFallback: true, circuitState: "OPEN" };
    }
  }

  // CLOSED or HALF_OPEN — attempt the real call
  try {
    const result = await fn();
    const current = getCircuit(dependency);

    if (current.state === "HALF_OPEN") {
      const newSuccessCount = current.successCount + 1;
      if (newSuccessCount >= cfg.successThreshold) {
        // Recovered — transition back to CLOSED
        updateCircuit(dependency, {
          state: "CLOSED",
          failureCount: 0,
          successCount: 0,
          openedAt: null,
          nextProbeAt: null,
        });
      } else {
        updateCircuit(dependency, { successCount: newSuccessCount });
      }
    } else {
      // CLOSED and successful — reset failure count
      updateCircuit(dependency, { failureCount: 0 });
    }

    return { result, usedFallback: false, circuitState: getCircuit(dependency).state };
  } catch (err) {
    // Record failure
    const current = getCircuit(dependency);
    const newFailureCount = current.failureCount + 1;
    const shouldOpen = current.state === "HALF_OPEN" || newFailureCount >= cfg.failureThreshold;

    if (shouldOpen) {
      updateCircuit(dependency, {
        state: "OPEN",
        failureCount: newFailureCount,
        lastFailureAt: now,
        openedAt: now,
        nextProbeAt: now + cfg.cooldownMs,
        successCount: 0,
      });
    } else {
      updateCircuit(dependency, {
        failureCount: newFailureCount,
        lastFailureAt: now,
      });
    }

    // Use fallback
    const result = await fallbackFn();
    return { result, usedFallback: true, circuitState: getCircuit(dependency).state };
  }
}

/** Get current state of all circuit breakers */
export function getAllCircuitStatuses(): CircuitBreakerStatus[] {
  // Return registered circuits plus any unregistered ones with CLOSED defaults
  const dependencies: DependencyName[] = [
    "aws_rekognition",
    "resend_email",
    "razorpay_payment",
    "supabase_db",
    "twilio_sms",
    "supabase_storage",
  ];
  return dependencies.map((dep) => getCircuit(dep));
}

/** Get status for a single circuit */
export function getCircuitStatus(dependency: DependencyName): CircuitBreakerStatus {
  return getCircuit(dependency);
}

/** Manually reset a circuit (admin operation) */
export function resetCircuit(dependency: DependencyName): void {
  updateCircuit(dependency, {
    state: "CLOSED",
    failureCount: 0,
    successCount: 0,
    lastFailureAt: null,
    openedAt: null,
    nextProbeAt: null,
  });
}

/** Legacy compatibility: simple simulation for tests */
export async function simulateDependencyFailure(
  dependency: DependencyName,
): Promise<{ dependency: DependencyName; simulatedFailure: boolean; fallbackTriggered: string }> {
  return {
    dependency,
    simulatedFailure: true,
    fallbackTriggered: FALLBACK_MAP[dependency],
  };
}
