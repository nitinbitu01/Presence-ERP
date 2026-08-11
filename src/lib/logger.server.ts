import { isPresenceErpError } from "./errors";

export type LogLevel = "info" | "warn" | "error" | "security";

export interface LogPayload {
  level: LogLevel;
  scope: string;
  message: string;
  details?: Record<string, unknown>;
  error?: Error | unknown;
  timestamp: string;
}

function formatLog(
  level: LogLevel,
  scope: string,
  message: string,
  details?: Record<string, unknown>,
  error?: Error | unknown,
): LogPayload {
  let formattedErr: Record<string, unknown> | undefined = undefined;
  if (isPresenceErpError(error)) {
    formattedErr = {
      name: error.name,
      code: error.code,
      statusCode: error.statusCode,
      message: error.message,
      details: error.details,
      stack: error.stack,
    };
  } else if (error instanceof Error) {
    formattedErr = { name: error.name, message: error.message, stack: error.stack };
  } else if (error) {
    formattedErr = { raw: String(error) };
  }

  return {
    level,
    scope,
    message,
    details,
    error: formattedErr,
    timestamp: new Date().toISOString(),
  };
}

export const logger = {
  info(scope: string, message: string, details?: Record<string, unknown>) {
    const payload = formatLog("info", scope, message, details);
    console.log(JSON.stringify(payload));
  },

  warn(scope: string, message: string, details?: Record<string, unknown>) {
    const payload = formatLog("warn", scope, message, details);
    console.warn(JSON.stringify(payload));
  },

  error(
    scope: string,
    message: string,
    error?: Error | unknown,
    details?: Record<string, unknown>,
  ) {
    const payload = formatLog("error", scope, message, details, error);
    console.error(JSON.stringify(payload));
  },

  security(scope: string, message: string, details?: Record<string, unknown>) {
    const payload = formatLog("security", scope, message, details);
    console.warn(JSON.stringify({ SECURITY_ALERT: true, ...payload }));
  },
};
