export type ErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_FAILED"
  | "CONFIG_ERROR"
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR"
  | "API_ERROR"
  | "NOT_FOUND"
  | "UNSUPPORTED_OPERATION"
  | "INTERNAL_ERROR";

export interface ErrorEnvelope {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
}

export interface SuccessEnvelope<T> {
  ok: true;
  data: T;
}

const sensitiveKey = /^(access_?token|refresh_?token|authorization|email|client_?secret)$/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redact(nested)
      ])
    );
  }
  return value;
}

export function successEnvelope<T>(data: T): SuccessEnvelope<T> {
  return { ok: true, data };
}

export function failureEnvelope(
  code: ErrorCode,
  message: string,
  retryable: boolean,
  details?: unknown
): ErrorEnvelope {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      ...(details === undefined ? {} : { details: redact(details) })
    }
  };
}

