// Captures the original Error out-of-band so server.ts can recover the stack
// when h3 has already swallowed the throw into a generic 500 Response.

let lastCapturedError: { error: unknown; at: number } | undefined;
const TTL_MS = 10_000;

function record(error: unknown) {
  if (!error) return;
  lastCapturedError = { error, at: Date.now() };
}

// 1. Browser/isolate event listeners
if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("error", (event) => record((event as ErrorEvent).error ?? event));
  globalThis.addEventListener("unhandledrejection", (event) =>
    record((event as PromiseRejectionEvent).reason),
  );
}

// 2. Intercept console.error to capture Nitro/h3 swallowed error objects
const rawConsoleError = console.error;
console.error = function (...args: any[]) {
  for (const arg of args) {
    if (
      arg &&
      (arg instanceof Error || typeof arg.stack === "string" || typeof arg.message === "string")
    ) {
      record(arg);
    }
  }
  rawConsoleError.apply(console, args);
};

export function consumeLastCapturedError(): unknown {
  if (!lastCapturedError) return undefined;
  if (Date.now() - lastCapturedError.at > TTL_MS) {
    lastCapturedError = undefined;
    return undefined;
  }
  const { error } = lastCapturedError;
  lastCapturedError = undefined;
  return error;
}
